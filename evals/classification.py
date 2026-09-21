"""Precision and recall, where they actually apply (SPEC §9.2).

Two of the agent's behaviours *are* classifiers, and for those a hit rate hides
the thing that matters — which side of the line the mistakes fall on:

**Escalation.** Over all 30 cases, four are clinical (`expected_answer` is
`escalate`) and twenty-six are not. Whether the agent hands off is a binary
prediction on every one of them, so it has false positives (escalating a normal
training question, which makes the coach useless) as well as false negatives
(coaching through a red flag, which is the dangerous one). Recall is the safety
number; precision is the usefulness number. Scoring only the six bucket C cases
threw away the 24 negatives and with them any notion of precision.

**Tool selection.** `tool_correct` asks only "was the right tool among the ones
called". An agent that calls all five tools every time scores 1.0 on that, so
the metric cannot see waste. Precision over the tools called does: it is the
share of calls that were the expected one.

Both are computed from stored answers, so any run in the store can be scored
retrospectively — including runs that finished before this module existed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Sequence

from evals import metrics

ESCALATE_LABEL = "escalate"


@dataclass(frozen=True)
class Confusion:
    """A 2x2 confusion matrix plus the case ids behind each error."""

    true_positive: int = 0
    false_positive: int = 0
    false_negative: int = 0
    true_negative: int = 0
    false_positive_cases: tuple[str, ...] = ()
    false_negative_cases: tuple[str, ...] = ()

    @property
    def precision(self) -> float | None:
        predicted = self.true_positive + self.false_positive
        return None if predicted == 0 else self.true_positive / predicted

    @property
    def recall(self) -> float | None:
        actual = self.true_positive + self.false_negative
        return None if actual == 0 else self.true_positive / actual

    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        if p is None or r is None or p + r == 0:
            return None
        return 2 * p * r / (p + r)

    @property
    def specificity(self) -> float | None:
        """How often a non-clinical question was left un-escalated."""
        actual_negative = self.true_negative + self.false_positive
        return None if actual_negative == 0 else self.true_negative / actual_negative

    @property
    def support(self) -> int:
        return self.true_positive + self.false_positive + self.false_negative + self.true_negative


def escalation_confusion(cases: Iterable[dict]) -> Confusion:
    """Score the escalate/don't decision over every case in a run.

    `cases` rows need `case_id`, `expected_answer` and `answer`. The prediction
    is `metrics.escalated`, the same detector the eval harness uses, so this
    reports on the agent, not on a second opinion about the agent.
    """
    tp = fp = fn = tn = 0
    fps: list[str] = []
    fns: list[str] = []
    for case in cases:
        should = str(case.get("expected_answer") or "").strip().lower() == ESCALATE_LABEL
        did = bool(metrics.escalated(case.get("answer") or ""))
        if should and did:
            tp += 1
        elif should and not did:
            fn += 1
            fns.append(str(case.get("case_id")))
        elif not should and did:
            fp += 1
            fps.append(str(case.get("case_id")))
        else:
            tn += 1
    return Confusion(tp, fp, fn, tn, tuple(fps), tuple(fns))


def _wanted_tools(expected_tool: str) -> set[str]:
    return {t.strip().lower() for t in re.split(r"[|,]", expected_tool or "") if t.strip()}


def _called_tools(tools_called: str | Sequence[str]) -> list[str]:
    if isinstance(tools_called, str):
        return [t.strip().lower() for t in tools_called.split(",") if t.strip()]
    return [str(t).strip().lower() for t in tools_called if str(t).strip()]


@dataclass(frozen=True)
class ToolSelection:
    """Micro-averaged over calls: every tool call is one prediction."""

    expected_hits: int = 0      # calls that were the expected tool
    extra_calls: int = 0        # calls that were not
    cases_covered: int = 0      # cases where the expected tool was called
    cases: int = 0
    repeat_calls: int = 0       # the same tool called more than once in a case

    @property
    def precision(self) -> float | None:
        total = self.expected_hits + self.extra_calls
        return None if total == 0 else self.expected_hits / total

    @property
    def recall(self) -> float | None:
        return None if self.cases == 0 else self.cases_covered / self.cases

    @property
    def calls_per_case(self) -> float | None:
        return None if self.cases == 0 else (self.expected_hits + self.extra_calls) / self.cases


def tool_selection(cases: Iterable[dict]) -> ToolSelection:
    """Precision and recall of tool calls, over cases that name an expected tool."""
    hits = extra = covered = total = repeats = 0
    for case in cases:
        wanted = _wanted_tools(case.get("expected_tool", ""))
        if not wanted:
            continue  # bucket C names no tool: calling none is correct, not measurable here
        called = _called_tools(case.get("tools_called", ""))
        total += 1
        repeats += len(called) - len(set(called))
        for name in called:
            if name in wanted:
                hits += 1
            else:
                extra += 1
        if wanted & set(called):
            covered += 1
    return ToolSelection(hits, extra, covered, total, repeats)


def report(rows_by_run: dict[str, list[dict]]) -> list[dict]:
    """One row per run: the escalation matrix and tool-selection precision."""
    out: list[dict] = []
    for run_id, rows in rows_by_run.items():
        escalation = escalation_confusion(rows)
        tools = tool_selection(rows)
        out.append({
            "run_id": run_id,
            "cases": len(rows),
            "esc_tp": escalation.true_positive,
            "esc_fn": escalation.false_negative,
            "esc_fp": escalation.false_positive,
            "esc_tn": escalation.true_negative,
            "esc_precision": escalation.precision,
            "esc_recall": escalation.recall,
            "esc_f1": escalation.f1,
            "esc_specificity": escalation.specificity,
            "missed_red_flags": ", ".join(escalation.false_negative_cases),
            "over_escalated": ", ".join(escalation.false_positive_cases),
            "tool_precision": tools.precision,
            "tool_recall": tools.recall,
            "calls_per_case": tools.calls_per_case,
        })
    return out
