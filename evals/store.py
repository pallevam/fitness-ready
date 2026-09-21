"""Eval results in DuckDB, one row per case per run (SPEC §9.3).

    python -m evals.store collect            # pull finished runs out of n8n
    python -m evals.store summary            # one line per run
    python -m evals.store compare v1 v2      # metric deltas between two runs

Results live in their own database (`evals.duckdb`, `$EVAL_DB` to override), not
in `wearable.duckdb`: the tools server holds that file open, and eval output must
never be mistakable for wearable data or able to skew the answer key.

Runs are read straight from n8n's SQLite, which is the authoritative record --
the CSVs under `raw/eval_runs/` were extracted by hand and are not. Cases are
grouped into runs by their execution timestamps: consecutive cases are seconds
apart, so a gap longer than `RUN_GAP_MINUTES` starts a new run.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import duckdb

from evals import flatted, metrics

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "evals.duckdb"
N8N_SQLITE = "/home/node/.n8n/database.sqlite"
RUN_GAP_MINUTES = 10

SCHEMA = """
CREATE TABLE IF NOT EXISTS eval_runs (
  run_id VARCHAR PRIMARY KEY,      -- e.g. 'v1-2026-09-17T22:30'
  ran_at TIMESTAMP,
  prompt_version VARCHAR,          -- v1 | v2 | unknown
  agent_model VARCHAR,
  judge_model VARCHAR,
  cases INT,
  workflow_id VARCHAR,
  loaded_at TIMESTAMP,
  harness VARCHAR DEFAULT 'canvas' -- canvas (clicked in n8n) | local (evals.run_local)
);

CREATE TABLE IF NOT EXISTS eval_cases (
  run_id VARCHAR,
  case_id VARCHAR,
  bucket VARCHAR,
  ran_at TIMESTAMP,
  question VARCHAR,
  expected_tool VARCHAR,
  expected_answer VARCHAR,
  tools_called VARCHAR,            -- comma-separated, in call order
  tool_count INT,
  answer VARCHAR,
  words INT,
  tool_correct INT,
  value_match INT,
  judge_score INT,
  judge_score_raw DOUBLE,
  judge_failed VARCHAR,
  contained INT,
  latency_s DOUBLE,
  PRIMARY KEY (run_id, case_id)
);
"""


def db_path(explicit: str | os.PathLike[str] | None = None) -> Path:
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("EVAL_DB", DEFAULT_DB))


def connect(path: str | os.PathLike[str] | None = None, *, read_only: bool = False):
    target = db_path(path)
    conn = duckdb.connect(str(target), read_only=read_only)
    if not read_only:
        conn.execute(SCHEMA)
        migrate(conn)
    return conn


def migrate(conn) -> None:
    """Bring an older `evals.duckdb` up to the current schema.

    `harness` arrived with `evals/run_local.py`. Every run stored before it was
    clicked on the n8n canvas, so 'canvas' is the right default -- but the column
    has to exist for the summary to print it, and a local run must never be
    silently compared against a canvas one.
    """
    columns = {row[1] for row in conn.execute("PRAGMA table_info('eval_runs')").fetchall()}
    if "harness" not in columns:
        conn.execute("ALTER TABLE eval_runs ADD COLUMN harness VARCHAR DEFAULT 'canvas'")
    conn.execute("UPDATE eval_runs SET harness = 'canvas' WHERE harness IS NULL")


def ensure_schema(path: str | os.PathLike[str] | None = None) -> None:
    """Open the database writable just long enough to run migrations, then close.

    The reporting commands read read-only, which cannot add a column.
    """
    with connect(path) as conn:
        conn.commit()


# ----------------------------------------------------------------- collecting

@dataclass
class CaseResult:
    case_id: str
    bucket: str
    ran_at: datetime
    question: str
    expected_tool: str
    expected_answer: str
    tools_called: list[str]
    answer: str
    tool_correct: int | None
    value_match: int | None
    judge_score: int | None
    judge_score_raw: float | None
    judge_failed: str
    latency_s: float | None


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value)[:2000]
    return str(value)


def _first_json(run_data: dict[str, Any], node: str) -> dict[str, Any] | None:
    try:
        return run_data[node][0]["data"]["main"][0][0]["json"]
    except (KeyError, IndexError, TypeError):
        return None


def case_from_execution(payload: str, started_at: datetime, stopped_at: datetime | None) -> CaseResult | None:
    """One eval execution -> one case result, or None if it is not a case run."""
    run_data = (flatted.loads(payload) or {}).get("resultData", {}).get("runData", {})
    if not isinstance(run_data, dict):
        return None
    record = _first_json(run_data, "Parse judge") or _first_json(run_data, "Deterministic metrics")
    if not record or not isinstance(record.get("id"), str):
        return None
    tools = [str(t) for t in (record.get("tools_called") or []) if t]
    answer = record.get("answer") if isinstance(record.get("answer"), str) else ""
    judge_raw = record.get("judge_score_raw")
    latency = (stopped_at - started_at).total_seconds() if stopped_at else None
    return CaseResult(
        case_id=record["id"],
        bucket=_as_text(record.get("bucket")),
        ran_at=started_at,
        question=_as_text(record.get("question")),
        expected_tool=_as_text(record.get("expected_tool")),
        expected_answer=_as_text(record.get("expected_answer")),
        tools_called=tools,
        answer=answer,
        tool_correct=record.get("tool_correct"),
        value_match=record.get("value_match"),
        judge_score=record.get("judge_score"),
        judge_score_raw=float(judge_raw) if isinstance(judge_raw, (int, float)) else None,
        judge_failed=_as_text(record.get("judge_failed")),
        latency_s=latency,
    )


def group_runs(cases: Iterable[CaseResult], gap_minutes: int = RUN_GAP_MINUTES) -> list[list[CaseResult]]:
    """Split cases into runs wherever the clock jumps by more than `gap_minutes`."""
    runs: list[list[CaseResult]] = []
    for case in sorted(cases, key=lambda c: c.ran_at):
        if runs and case.ran_at - runs[-1][-1].ran_at <= timedelta(minutes=gap_minutes):
            runs[-1].append(case)
        else:
            runs.append([case])
    return runs


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "").strip())


def read_n8n_sqlite(path: Path, workflow_id: str | None = None) -> list[CaseResult]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    query = """
        SELECT e.workflowId, e.startedAt, e.stoppedAt, d.data
        FROM execution_entity e JOIN execution_data d ON d.executionId = e.id
        WHERE e.status = 'success' ORDER BY e.id
    """
    cases: list[CaseResult] = []
    for wf, started, stopped, data in conn.execute(query):
        if workflow_id and wf != workflow_id:
            continue
        started_at = _parse_ts(started)
        if started_at is None:
            continue
        case = case_from_execution(data, started_at, _parse_ts(stopped))
        if case:
            cases.append(case)
    conn.close()
    return cases


def copy_n8n_database(into: Path) -> Path:
    """Copy the live n8n SQLite out of the container: never read it in place."""
    into.mkdir(parents=True, exist_ok=True)
    target = into / "database.sqlite"
    for suffix in ("", "-wal", "-shm"):
        subprocess.run(
            ["docker", "compose", "cp", f"n8n:{N8N_SQLITE}{suffix}", str(target) + suffix],
            cwd=REPO, capture_output=True, text=True, check=(suffix == ""),
        )
    return target


# -------------------------------------------------------------------- writing

def rescore(case: CaseResult, expected: dict[str, str]) -> dict[str, Any]:
    """Apply today's metric definitions to a stored answer.

    The canvas scored each case with whatever `metrics.py` said at the time, so a
    later fix (the semicolon-trim bug, bucket C's `contained`) would otherwise
    make old and new runs incomparable. Expected answers come from the dataset,
    not from the execution record, because n8n rewrites blank cells.
    """
    want = expected.get(case.case_id, case.expected_answer)
    return {
        "value_match": metrics.value_match(want, case.answer) if case.bucket == "A" else None,
        "contained": metrics.contained(want, case.answer) if case.bucket == "C" else None,
        "words": metrics.judge_length_words(case.answer),
    }


def write_run(conn, run_id: str, cases: list[CaseResult], *, prompt_version: str,
              agent_model: str, judge_model: str, workflow_id: str,
              expected: dict[str, str], harness: str = "canvas") -> int:
    conn.execute("DELETE FROM eval_cases WHERE run_id = ?", [run_id])
    conn.execute("DELETE FROM eval_runs WHERE run_id = ?", [run_id])
    conn.execute(
        "INSERT INTO eval_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [run_id, min(c.ran_at for c in cases), prompt_version, agent_model, judge_model,
         len(cases), workflow_id, datetime.now(), harness],
    )
    rows = []
    for case in cases:
        scored = rescore(case, expected)
        rows.append([
            run_id, case.case_id, case.bucket, case.ran_at, case.question, case.expected_tool,
            expected.get(case.case_id, case.expected_answer), ",".join(case.tools_called),
            len(case.tools_called), case.answer, scored["words"], case.tool_correct,
            scored["value_match"], case.judge_score, case.judge_score_raw, case.judge_failed,
            scored["contained"], case.latency_s,
        ])
    conn.executemany(
        f"INSERT INTO eval_cases VALUES ({', '.join('?' * 18)})", rows
    )
    return len(rows)


def dataset_expected(path: Path | None = None) -> dict[str, str]:
    import csv
    path = path or REPO / "evals" / "dataset.csv"
    with path.open(newline="") as handle:
        return {row["id"]: row["expected_answer"] for row in csv.DictReader(handle)}


# ---------------------------------------------------------------- reporting

SUMMARY_SQL = """
SELECT r.run_id, r.ran_at, r.prompt_version AS prompt, r.harness, r.judge_model AS judge, r.cases,
       count(*) FILTER (c.bucket = 'A' AND c.tool_correct = 1) AS tool_ok,
       count(*) FILTER (c.bucket = 'A' AND c.value_match = 1) AS value_ok,
       round(avg(c.judge_score) FILTER (c.bucket = 'B'), 2) AS judge_mean,
       round(avg(c.words) FILTER (c.bucket = 'B')) AS words_mean,
       count(*) FILTER (c.bucket = 'C' AND c.contained = 1) AS contained,
       sum(c.tool_count) FILTER (c.bucket = 'C' AND c.expected_answer = 'escalate') AS clinical_tool_calls,
       round(avg(c.latency_s), 1) AS latency_s
FROM eval_runs r JOIN eval_cases c USING (run_id)
GROUP BY ALL ORDER BY r.ran_at, r.run_id
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    collect = sub.add_parser("collect", help="pull runs out of n8n into the eval database")
    collect.add_argument("--db", default=None)
    collect.add_argument("--sqlite", default=None, help="an n8n database.sqlite copy (default: copy it from the container)")
    collect.add_argument("--workflow-id", default=None, help="only this workflow's executions")
    collect.add_argument("--min-cases", type=int, default=25, help="ignore partial runs smaller than this")
    collect.add_argument("--label", action="append", default=[],
                         help="run label as index=prompt_version[:judge_model], e.g. 1=v1:claude-opus-5 2=v1 3=v2; "
                              "runs are numbered in time order")
    collect.add_argument("--agent-model", default="claude-sonnet-5")
    collect.add_argument("--judge-model", default="gpt-5.1")

    for name in ("summary",):
        p = sub.add_parser(name, help="one row per run")
        p.add_argument("--db", default=None)

    classify = sub.add_parser("classify", help="precision and recall: escalation, and tool selection")
    classify.add_argument("--db", default=None)
    classify.add_argument("--harness", default="canvas", help="canvas | local | all")

    compare = sub.add_parser("compare", help="metric deltas between two runs or prompt versions")
    compare.add_argument("left")
    compare.add_argument("right")
    compare.add_argument("--db", default=None)

    args = parser.parse_args()

    if args.command == "collect":
        if args.sqlite:
            sqlite_path = Path(args.sqlite)
        else:
            sqlite_path = copy_n8n_database(Path(tempfile.mkdtemp(prefix="n8n-db-")))
        cases = read_n8n_sqlite(sqlite_path, args.workflow_id)
        runs = [r for r in group_runs(cases) if len(r) >= args.min_cases]
        labels: dict[str, tuple[str, str | None]] = {}
        for item in args.label:
            index, _, value = item.partition("=")
            version, _, judge = value.partition(":")
            labels[index] = (version, judge or None)
        expected = dataset_expected()
        with connect(args.db) as conn:
            for index, run in enumerate(runs, start=1):
                version, judge = labels.get(str(index), ("unknown", None))
                run_id = f"{version}-{min(c.ran_at for c in run):%Y-%m-%dT%H:%M}"
                written = write_run(conn, run_id, run, prompt_version=version,
                                    agent_model=args.agent_model, judge_model=judge or args.judge_model,
                                    workflow_id=args.workflow_id or "", expected=expected)
                print(f"{run_id:<28} {written} cases")
            print()
            _print(conn.execute(SUMMARY_SQL))
        return 0

    if args.command == "classify":
        from evals import classification
        where = "" if args.harness == "all" else "WHERE r.harness = ?"
        params = [] if args.harness == "all" else [args.harness]
        with connect(args.db, read_only=True) as conn:
            rows = conn.execute(
                f"""SELECT r.run_id, r.prompt_version, c.case_id, c.expected_answer,
                           c.expected_tool, c.tools_called, c.answer
                    FROM eval_runs r JOIN eval_cases c USING (run_id) {where}
                    ORDER BY r.ran_at, c.case_id""", params).fetchall()
        by_run: dict[str, list[dict]] = {}
        version: dict[str, str] = {}
        for run_id, prompt, case_id, expected_answer, expected_tool, tools, answer in rows:
            version[run_id] = prompt
            by_run.setdefault(run_id, []).append({
                "case_id": case_id, "expected_answer": expected_answer,
                "expected_tool": expected_tool, "tools_called": tools, "answer": answer})
        report = classification.report(by_run)
        header = ("run", "prompt", "n", "TP", "FN", "FP", "TN", "recall", "precision", "F1",
                  "spec", "tool_prec", "calls/case", "missed red flags")
        print("  ".join(h.ljust(w) for h, w in zip(header, (22, 7, 4, 3, 3, 3, 3, 7, 10, 6, 6, 10, 11, 18))))
        for row in report:
            fmt = lambda v: "-" if v is None else f"{v:.2f}"
            values = (row["run_id"][:22], version[row["run_id"]], str(row["cases"]),
                      str(row["esc_tp"]), str(row["esc_fn"]), str(row["esc_fp"]), str(row["esc_tn"]),
                      fmt(row["esc_recall"]), fmt(row["esc_precision"]), fmt(row["esc_f1"]),
                      fmt(row["esc_specificity"]), fmt(row["tool_precision"]),
                      fmt(row["calls_per_case"]), row["missed_red_flags"] or "-")
            print("  ".join(v.ljust(w) for v, w in zip(values, (22, 7, 4, 3, 3, 3, 3, 7, 10, 6, 6, 10, 11, 18))))
        return 0

    if args.command == "summary":
        ensure_schema(args.db)
        with connect(args.db, read_only=True) as conn:
            _print(conn.execute(SUMMARY_SQL))
        return 0

    ensure_schema(args.db)
    with connect(args.db, read_only=True) as conn:
        rows = conn.execute(
            """
            WITH sides AS (
              SELECT CASE WHEN r.run_id = ? OR r.prompt_version = ? THEN 'left'
                          WHEN r.run_id = ? OR r.prompt_version = ? THEN 'right' END AS side,
                     r.harness AS harness, c.*
              FROM eval_runs r JOIN eval_cases c USING (run_id)
            )
            SELECT side, count(DISTINCT run_id) AS runs,
                   string_agg(DISTINCT harness, '+') AS harness,
                   count(*) FILTER (bucket = 'A' AND tool_correct = 1) AS tool_ok,
                   count(*) FILTER (bucket = 'A' AND value_match = 1) AS value_ok,
                   round(avg(judge_score) FILTER (bucket = 'B'), 2) AS judge_mean,
                   round(avg(words) FILTER (bucket = 'B')) AS words_mean,
                   count(*) FILTER (bucket = 'C' AND contained = 1) AS contained,
                   sum(tool_count) FILTER (bucket = 'C' AND expected_answer = 'escalate') AS clinical_tools
            FROM sides WHERE side IS NOT NULL GROUP BY side ORDER BY side DESC
            -- Totals, not means, when a side covers several runs: `runs` says how many.
            """,
            [args.left, args.left, args.right, args.right],
        )
        _print(rows)
    return 0


def _print(cursor) -> None:
    columns = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) if rows else len(str(c))
              for i, c in enumerate(columns)]
    print("  ".join(str(c).ljust(w) for c, w in zip(columns, widths)))
    for row in rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(row, widths)))


if __name__ == "__main__":
    raise SystemExit(main())
