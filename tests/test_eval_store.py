"""The eval result store: flatted decoding, run grouping, and the DuckDB tables.

No docker and no network: every test builds its own n8n-shaped payload.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest

from evals import flatted, store


# ------------------------------------------------------------------ flatted

def test_flatted_resolves_string_indices():
    payload = json.dumps([{"a": "1", "b": "2"}, "hello", {"c": "1"}])
    assert flatted.loads(payload) == {"a": "hello", "b": {"c": "hello"}}


def test_a_resolved_string_is_never_resolved_again():
    """The bug this module exists for: an answer of "5" is a value, not a pointer."""
    payload = json.dumps([{"expected_answer": "1", "other": "2"}, "5", {"junk": "1"}])
    assert flatted.loads(payload) == {"expected_answer": "5", "other": {"junk": "5"}}


def test_inline_primitives_are_kept():
    payload = json.dumps([{"n": 61, "ok": True, "missing": None, "s": "1"}, "text"])
    assert flatted.loads(payload) == {"n": 61, "ok": True, "missing": None, "s": "text"}


def test_cycles_do_not_hang():
    payload = json.dumps([{"self": "0"}])
    decoded = flatted.loads(payload)
    assert decoded["self"] is decoded


# --------------------------------------------------------------- executions

def _execution(case_id: str, bucket: str, *, answer: str, tools: list[str],
               judge: int | None = None, expected: str = "") -> str:
    record = {
        "id": case_id, "bucket": bucket, "question": f"question {case_id}",
        "expected_tool": "get_sleep", "expected_answer": expected, "answer": answer,
        "tools_called": tools, "tool_correct": 1, "value_match": 1,
    }
    if judge is not None:
        record["judge_score"] = judge
        record["judge_score_raw"] = judge
        record["judge_failed"] = "one_action: stacked"
    node = "Parse judge" if judge is not None else "Deterministic metrics"
    run = {"resultData": {"runData": {node: [{"data": {"main": [[{"json": record}]]}}]}}}
    # A flatted payload is not required here: the decoder passes plain JSON through
    # unchanged only for lists, so build the array form the way n8n does.
    pool: list = []

    def flatten(value):
        if isinstance(value, (dict, list)):
            pool.append(None)
            index = len(pool) - 1
            if isinstance(value, dict):
                pool[index] = {k: flatten(v) for k, v in value.items()}
            else:
                pool[index] = [flatten(v) for v in value]
            return str(index)
        if isinstance(value, str):
            pool.append(value)
            return str(len(pool) - 1)
        return value

    flatten(run)
    # element 0 must be the root
    root = pool.pop(0)
    pool.insert(0, root)
    return json.dumps(pool)


def test_a_case_is_extracted_from_an_execution():
    started = datetime(2026, 9, 17, 22, 30, 0)
    payload = _execution("A01", "A", answer="57.8 bpm", tools=["get_daily_metrics"], expected="57.8")
    case = store.case_from_execution(payload, started, started + timedelta(seconds=9))
    assert case is not None
    assert (case.case_id, case.bucket, case.tools_called) == ("A01", "A", ["get_daily_metrics"])
    assert case.latency_s == pytest.approx(9.0)


def test_an_execution_without_a_case_record_is_ignored():
    payload = json.dumps([{"resultData": "1"}, {"runData": "2"}, {}])
    assert store.case_from_execution(payload, datetime(2026, 9, 17), None) is None


def test_runs_are_split_on_a_clock_gap():
    base = datetime(2026, 9, 17, 22, 0)
    cases = [
        store.CaseResult("A01", "A", base, "", "", "", [], "", 1, 1, None, None, "", 1.0),
        store.CaseResult("A02", "A", base + timedelta(seconds=25), "", "", "", [], "", 1, 1, None, None, "", 1.0),
        store.CaseResult("A01", "A", base + timedelta(minutes=40), "", "", "", [], "", 1, 1, None, None, "", 1.0),
    ]
    runs = store.group_runs(cases)
    assert [len(r) for r in runs] == [2, 1]


# -------------------------------------------------------------------- store

def _write(tmp_path: Path, run_id: str, version: str, cases: list[store.CaseResult],
           harness: str = "canvas") -> None:
    with store.connect(tmp_path / "evals.duckdb") as conn:
        store.write_run(conn, run_id, cases, prompt_version=version, agent_model="claude-sonnet-5",
                        judge_model="gpt-5.1", workflow_id="W1", harness=harness,
                        expected={"A03": "2026-09-08; 2026-09-10", "C01": "escalate"})


def _case(case_id, bucket, answer, tools=(), judge=None, ran_at=None):
    return store.CaseResult(case_id, bucket, ran_at or datetime(2026, 9, 17, 22, 30), "q", "get_sleep",
                            "", list(tools), answer, 1, None, judge, judge, "", 2.0)


def test_cases_round_trip_and_are_rescored_with_todays_metrics(tmp_path):
    """The canvas scored A03 with the pre-fix metric; the store must not inherit it."""
    cases = [
        _case("A03", "A", "Unreliable: **2026-09-08** and **2026-09-10**."),
        _case("B01", "B", "one two three", judge=4),
        _case("C01", "C", "Please contact a clinician about the chest tightness.", tools=()),
    ]
    _write(tmp_path, "v2-2026-09-17T22:30", "v2", cases)
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        rows = dict(conn.execute("SELECT case_id, value_match FROM eval_cases WHERE bucket='A'").fetchall())
        assert rows == {"A03": 1}
        assert conn.execute("SELECT contained FROM eval_cases WHERE case_id='C01'").fetchone()[0] == 1
        assert conn.execute("SELECT words FROM eval_cases WHERE case_id='B01'").fetchone()[0] == 3
        assert conn.execute("SELECT cases FROM eval_runs").fetchone()[0] == 3


def test_reloading_a_run_replaces_it_rather_than_duplicating(tmp_path):
    cases = [_case("A01", "A", "57.8 bpm")]
    _write(tmp_path, "v1-2026-09-17T22:30", "v1", cases)
    _write(tmp_path, "v1-2026-09-17T22:30", "v1", cases)
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        assert conn.execute("SELECT count(*) FROM eval_cases").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM eval_runs").fetchone()[0] == 1


def test_summary_reports_one_row_per_run(tmp_path):
    _write(tmp_path, "v1-x", "v1", [_case("C01", "C", "go again tomorrow, it is probably fine", tools=("get_sleep",))])
    _write(tmp_path, "v2-x", "v2", [_case("C01", "C", "Please see a clinician.")])
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        rows = conn.execute(store.SUMMARY_SQL).fetchall()
        columns = [d[0] for d in conn.execute(store.SUMMARY_SQL).description]
    by_run = {r[columns.index("run_id")]: r for r in rows}
    assert by_run["v1-x"][columns.index("contained")] == 0
    assert by_run["v2-x"][columns.index("contained")] == 1


def test_a_run_is_canvas_unless_it_says_otherwise(tmp_path):
    """The default matters: every run stored before `run_local.py` was clicked."""
    _write(tmp_path, "v1-x", "v1", [_case("A01", "A", "57.8 bpm")])
    _write(tmp_path, "v1-local-x", "v1", [_case("A01", "A", "57.8 bpm")], harness="local")
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        assert dict(conn.execute("SELECT run_id, harness FROM eval_runs").fetchall()) == {
            "v1-x": "canvas", "v1-local-x": "local"}


def test_the_summary_names_the_harness_so_the_two_are_never_conflated(tmp_path):
    _write(tmp_path, "v1-x", "v1", [_case("A01", "A", "57.8 bpm")])
    _write(tmp_path, "v1-local-x", "v1", [_case("A01", "A", "57.8 bpm")], harness="local")
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        columns = [d[0] for d in conn.execute(store.SUMMARY_SQL).description]
        rows = conn.execute(store.SUMMARY_SQL).fetchall()
    assert "harness" in columns
    by_run = {r[columns.index("run_id")]: r[columns.index("harness")] for r in rows}
    assert by_run == {"v1-x": "canvas", "v1-local-x": "local"}


def test_an_older_database_gains_the_harness_column_as_canvas(tmp_path):
    """The migration path: a pre-`harness` eval_runs table, opened writable."""
    path = tmp_path / "evals.duckdb"
    conn = duckdb.connect(str(path))
    conn.execute("""
        CREATE TABLE eval_runs (run_id VARCHAR PRIMARY KEY, ran_at TIMESTAMP,
          prompt_version VARCHAR, agent_model VARCHAR, judge_model VARCHAR, cases INT,
          workflow_id VARCHAR, loaded_at TIMESTAMP)
    """)
    conn.execute("INSERT INTO eval_runs VALUES ('v1-2026-09-17T22:30', now(), 'v1', 'a', 'j', 30, 'W1', now())")
    conn.close()

    with store.connect(path) as migrated:
        assert migrated.execute("SELECT harness FROM eval_runs").fetchone()[0] == "canvas"


def test_reading_an_n8n_sqlite_copy(tmp_path):
    path = tmp_path / "database.sqlite"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE execution_entity (id INTEGER PRIMARY KEY, workflowId TEXT, status TEXT, startedAt TEXT, stoppedAt TEXT)")
    conn.execute("CREATE TABLE execution_data (executionId INTEGER, data TEXT)")
    conn.execute("INSERT INTO execution_entity VALUES (1, 'WEVAL', 'success', '2026-09-17 22:30:00.000', '2026-09-17 22:30:09.000')")
    conn.execute("INSERT INTO execution_data VALUES (1, ?)", [_execution("A01", "A", answer="57.8", tools=["get_daily_metrics"])])
    conn.execute("INSERT INTO execution_entity VALUES (2, 'WOTHER', 'success', '2026-09-17 22:31:00.000', NULL)")
    conn.execute("INSERT INTO execution_data VALUES (2, ?)", [_execution("A02", "A", answer="x", tools=[])])
    conn.commit(); conn.close()

    everything = store.read_n8n_sqlite(path)
    assert {c.case_id for c in everything} == {"A01", "A02"}
    filtered = store.read_n8n_sqlite(path, "WEVAL")
    assert [c.case_id for c in filtered] == ["A01"]
