#!/usr/bin/env python3
"""Judge–human calibration: how often does the LLM judge agree with a person?

    python scripts/rejudge_calibration.py --report
    python scripts/rejudge_calibration.py --judge judge_prompt_v3.md --write

`evals/calibration/calibration.json` holds twelve bucket B answers from the
17 Sep canvas runs, each with the tool results the agent saw, a human grading
(Vamsi, assisted by ChatGPT, blind to the judge and to the prompt version -- say
so on stage), and the judge's own grading under two rubric versions.

`--report` compares the stored gradings; `--judge` re-runs the judge with a
rubric and reports that instead. The judge sees the agent's system prompt from
v3 onwards: without it, the agent's own readiness vocabulary (Green/Amber/Red)
reads as invented and `grounded` fails for the wrong reason.

Agreement alone flatters a lenient judge, so kappa is reported next to it: a
criterion the human always fails carries no information and lands near zero
however often the two agree.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "evals" / "calibration" / "calibration.json"
LITELLM_URL = "http://localhost:4000/v1/chat/completions"
JUDGE_MODEL = "gpt-5.1"
CRITERIA = ["grounded", "trend", "one_action", "uncertainty", "no_overreach"]


def api_key() -> str:
    for line in (REPO / ".env").read_text().splitlines():
        if line.startswith("LITELLM_MASTER_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


def system_prompt(version: str) -> str:
    """The agent's own instructions, minus the repo notes under the prompt."""
    text = (REPO / "prompts" / f"system_{version}.md").read_text()
    return text.split("---\n\n**This prompt")[0].strip()


def judge_one(row: dict, rubric: str, key: str) -> dict:
    body = {
        "system_prompt": system_prompt(row["prompt_version"]),
        "question": row["question"],
        "as_of_date": row["as_of_date"],
        "tool_results": row["tool_results"],
        "answer": row["answer"],
        "rubric_notes": row["rubric_notes"],
    }
    request = urllib.request.Request(
        LITELLM_URL,
        data=json.dumps({"model": JUDGE_MODEL, "messages": [
            {"role": "system", "content": rubric},
            {"role": "user", "content": json.dumps(body, indent=1)},
        ]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        content = json.load(response)["choices"][0]["message"]["content"]
    match = re.search(r"\{.*\}", content, re.S)
    if not match:
        raise SystemExit(f"{row['gid']}: judge returned no JSON")
    return json.loads(match.group(0))


def kappa(pairs: list[tuple[int, int]]) -> tuple[float, float]:
    """(raw agreement, Cohen's kappa) for one criterion."""
    n = len(pairs)
    observed = sum(a == b for a, b in pairs) / n
    p_human = sum(a for a, _ in pairs) / n
    p_judge = sum(b for _, b in pairs) / n
    expected = p_human * p_judge + (1 - p_human) * (1 - p_judge)
    return observed, (observed - expected) / (1 - expected) if expected < 1 else float("nan")


def report(rows: list[dict], columns: list[tuple[str, str]]) -> None:
    head = "".join(f"{label:>18}" for label, _ in columns)
    print(f"{'criterion':<15}{head}")
    totals: dict[str, list[tuple[int, int]]] = {label: [] for label, _ in columns}
    for criterion in CRITERIA:
        line = f"{criterion:<15}"
        for label, field in columns:
            pairs = [(r["human_chatgpt"][criterion], r[field][criterion]) for r in rows]
            totals[label] += pairs
            agree, k = kappa(pairs)
            line += f"{sum(a == b for a, b in pairs):>9}/{len(pairs):<3} k={k:>4.2f}"
        print(line)
    line = f"{'all':<15}"
    for label, _ in columns:
        pairs = totals[label]
        agree, k = kappa(pairs)
        line += f"{sum(a == b for a, b in pairs):>9}/{len(pairs):<3} k={k:>4.2f}"
    print(line)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--judge", help="rubric in evals/ to re-run, e.g. judge_prompt_v3.md")
    parser.add_argument("--write", action="store_true", help="store the re-run as judge_v3 in the data file")
    parser.add_argument("--report", action="store_true", help="compare the stored gradings")
    args = parser.parse_args()

    rows = json.loads(DATA.read_text())

    if args.judge:
        rubric = (REPO / "evals" / args.judge).read_text()
        key = api_key()
        with ThreadPoolExecutor(max_workers=6) as pool:
            verdicts = list(pool.map(lambda r: judge_one(r, rubric, key), rows))
        for row, verdict in zip(rows, verdicts):
            row["judge_rerun"] = verdict["criteria"]
            row["judge_rerun_failed"] = verdict.get("failed")
            if args.write:
                row["judge_v3"] = verdict["criteria"]
                row["judge_v3_score"] = verdict.get("judge_score")
                row["judge_v3_failed"] = verdict.get("failed")
        if args.write:
            DATA.write_text(json.dumps(rows, indent=1, ensure_ascii=False))
        report(rows, [("judge v2", "judge_v2"), (args.judge.replace("judge_prompt_", "").replace(".md", ""), "judge_rerun")])
        return

    report(rows, [("judge v2", "judge_v2"), ("judge v3", "judge_v3")])


if __name__ == "__main__":
    main()
