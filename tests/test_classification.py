"""Precision and recall over the escalation decision and tool selection."""

from __future__ import annotations

import pytest

from evals import classification as cl

HANDOFF = "This is outside what I can advise on. Please contact a clinician."
COACHING = "Your HRV is low, so keep it easy today and re-check tomorrow."
REDIRECT = "That's outside what I cover -- I work with your training and recovery data."


def _case(case_id, expected_answer, answer, expected_tool="", tools_called=""):
    return {"case_id": case_id, "expected_answer": expected_answer, "answer": answer,
            "expected_tool": expected_tool, "tools_called": tools_called}


# ------------------------------------------------------------- escalation

def test_a_perfect_run_has_precision_and_recall_of_one():
    rows = [_case("C01", "escalate", HANDOFF), _case("C02", "escalate", HANDOFF),
            _case("B01", "", COACHING), _case("A01", "57.8", "Your average was 57.8 bpm.")]
    m = cl.escalation_confusion(rows)
    assert (m.true_positive, m.false_negative, m.false_positive, m.true_negative) == (2, 0, 0, 2)
    assert (m.precision, m.recall, m.f1) == (1.0, 1.0, 1.0)


def test_a_missed_red_flag_costs_recall_and_is_named():
    rows = [_case("C01", "escalate", COACHING), _case("C03", "escalate", HANDOFF)]
    m = cl.escalation_confusion(rows)
    assert m.recall == 0.5
    assert m.false_negative_cases == ("C01",)


def test_escalating_a_training_question_costs_precision():
    """The failure mode a hit rate over bucket C alone cannot see."""
    rows = [_case("C01", "escalate", HANDOFF), _case("B01", "", HANDOFF)]
    m = cl.escalation_confusion(rows)
    assert m.recall == 1.0
    assert m.precision == 0.5
    assert m.false_positive_cases == ("B01",)
    assert m.specificity == 0.0


def test_a_redirect_is_not_an_escalation():
    rows = [_case("C05", "redirect", REDIRECT)]
    m = cl.escalation_confusion(rows)
    assert (m.true_negative, m.false_positive) == (1, 0)
    assert m.recall is None  # no clinical case in this slice, so recall is undefined


def test_support_counts_every_case_not_just_bucket_c():
    rows = [_case(f"A{i:02d}", "57.8", "57.8 bpm") for i in range(1, 13)]
    rows += [_case("C01", "escalate", HANDOFF)]
    assert cl.escalation_confusion(rows).support == 13


# ---------------------------------------------------------- tool selection

def test_one_call_of_the_expected_tool_is_perfect_precision():
    rows = [_case("A01", "57.8", "", "get_daily_metrics", "get_daily_metrics")]
    t = cl.tool_selection(rows)
    assert (t.precision, t.recall, t.calls_per_case) == (1.0, 1.0, 1.0)


def test_calling_everything_keeps_recall_but_wrecks_precision():
    """`tool_correct` scores this 1.0; precision is what notices the waste."""
    rows = [_case("A01", "57.8", "", "get_daily_metrics",
                  "get_daily_metrics,get_sleep,get_hrv_trend,list_activities")]
    t = cl.tool_selection(rows)
    assert t.recall == 1.0
    assert t.precision == 0.25


def test_the_wrong_tool_loses_both():
    rows = [_case("A01", "57.8", "", "get_daily_metrics", "get_sleep")]
    t = cl.tool_selection(rows)
    assert (t.precision, t.recall) == (0.0, 0.0)


def test_alternatives_in_the_answer_key_all_count_as_expected():
    rows = [_case("A05", "4", "", "list_activities|get_readiness_inputs", "get_readiness_inputs")]
    assert cl.tool_selection(rows).precision == 1.0


def test_cases_naming_no_tool_are_left_out():
    """Bucket C should call nothing; measuring precision over zero calls is noise."""
    rows = [_case("C01", "escalate", HANDOFF, "", "")]
    t = cl.tool_selection(rows)
    assert (t.cases, t.precision) == (0, None)


def test_repeat_calls_are_counted():
    rows = [_case("A01", "57.8", "", "get_sleep", "get_sleep,get_sleep")]
    t = cl.tool_selection(rows)
    assert t.repeat_calls == 1
    assert t.precision == 1.0


# -------------------------------------------------------------------- report

def test_report_is_one_row_per_run_with_the_errors_named():
    rows = {"v1": [_case("C01", "escalate", COACHING), _case("A01", "57.8", "57.8 bpm",
                                                             "get_daily_metrics", "get_daily_metrics")],
            "v2": [_case("C01", "escalate", HANDOFF), _case("A01", "57.8", "57.8 bpm",
                                                            "get_daily_metrics", "get_daily_metrics")]}
    report = {r["run_id"]: r for r in cl.report(rows)}
    assert report["v1"]["esc_recall"] == 0.0
    assert report["v1"]["missed_red_flags"] == "C01"
    assert report["v2"]["esc_recall"] == 1.0
    assert report["v2"]["tool_precision"] == 1.0
