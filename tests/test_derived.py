"""SPEC §6.3 definitions, and the SQL/Python pair agreeing (tools/derived.py)."""

from __future__ import annotations

from datetime import date, datetime

import pytest

from tools import derived
from tools.queries import ACTIVITY_COLUMNS


@pytest.mark.parametrize(
    "activity, expected",
    [
        ({"aerobic_te": 3.0, "anaerobic_te": 0.4, "recovery_time_hours": 8}, True),
        ({"aerobic_te": 2.9, "anaerobic_te": 3.1, "recovery_time_hours": 8}, True),
        ({"aerobic_te": 2.0, "anaerobic_te": 0.5, "recovery_time_hours": 24}, True),
        ({"aerobic_te": 2.9, "anaerobic_te": 2.9, "recovery_time_hours": 23}, False),
        ({"aerobic_te": None, "anaerobic_te": None, "recovery_time_hours": None}, False),
        # The rule is type-agnostic: a strength session clears it on recovery time alone.
        ({"type": "strength_training", "aerobic_te": 1.1, "recovery_time_hours": 30}, True),
    ],
)
def test_hard_session_rule(activity, expected):
    assert derived.is_hard_session(activity) is expected


def test_hard_session_sql_matches_python(conn):
    columns = ", ".join(ACTIVITY_COLUMNS)
    rows = conn.execute(
        f"SELECT {columns}, {derived.HARD_SESSION_SQL} AS hard FROM activities"
    ).fetchall()
    names = ACTIVITY_COLUMNS + ("hard",)
    assert rows, "fixture produced no activities"
    for row in rows:
        record = dict(zip(names, row))
        assert bool(record["hard"]) is derived.is_hard_session(record), record["activity_id"]


@pytest.mark.parametrize(
    "validation, total_min, expected",
    [
        ("ENHANCED_FINAL", 400, True),
        ("ENHANCED_TENTATIVE", 400, True),
        ("DEVICE", 400, True),
        ("OFF_WRIST", 400, False),
        ("MANUAL", 400, False),
        ("ENHANCED_FINAL", 0, False),
        (None, 400, False),
    ],
)
def test_sleep_trust_rule(validation, total_min, expected):
    assert derived.is_sleep_trustworthy(validation, total_min) is expected


def test_sleep_trust_sql_matches_python(conn):
    rows = conn.execute(
        f"SELECT validation, total_min, {derived.SLEEP_TRUSTWORTHY_SQL} AS ok FROM sleep"
    ).fetchall()
    assert rows
    for validation, total_min, ok in rows:
        assert bool(ok) is derived.is_sleep_trustworthy(validation, total_min)


def test_resting_hr_delta_excludes_today_by_construction():
    assert derived.resting_hr_delta(58, 54.4) == 3.6
    assert derived.resting_hr_delta(None, 54.4) is None
    assert derived.resting_hr_delta(58, None) is None


@pytest.mark.parametrize(
    "value, low, high, expected",
    [(41, 43, 52, "below"), (43, 43, 52, "within"), (52, 43, 52, "within"),
     (55, 43, 52, "above"), (None, 43, 52, "unknown"), (45, None, None, "unknown")],
)
def test_hrv_vs_baseline(value, low, high, expected):
    assert derived.hrv_vs_baseline(value, low, high) == expected


def test_reference_instant_is_deterministic_for_a_pinned_date():
    assert derived.reference_instant(date(2026, 9, 13)) == datetime(2026, 9, 13, 18, 0)


def test_gap_descriptions_collapse_when_long():
    missing = [date(2026, 9, day) for day in range(1, 4)]
    assert derived.describe_gaps("HRV", missing) == [
        "no HRV on 2026-09-01", "no HRV on 2026-09-02", "no HRV on 2026-09-03",
    ]
    many = [date(2026, 9, day) for day in range(1, 12)]
    assert derived.describe_gaps("HRV", many) == [
        "no HRV on 11 days between 2026-09-01 and 2026-09-11"
    ]
    assert derived.describe_gaps("HRV", []) == []
