"""The post-sync check behind the morning notification."""

from __future__ import annotations

from datetime import date

from fetcher.check import last_night_problem

# Fixture nights (see tests/test_tools_api.py): 08 Sep is OFF_WRIST, 10 Sep is
# MANUAL, 13 Sep is a normal scored night, and nothing exists after 13 Sep.


def test_a_normal_night_is_silent(conn):
    assert last_night_problem(conn, date(2026, 9, 13)) is None


def test_a_missing_night_says_what_to_do(conn):
    problem = last_night_problem(conn, date(2026, 9, 14))
    assert problem is not None and "Garmin Connect" in problem


def test_off_wrist_and_manual_nights_are_flagged(conn):
    assert "OFF_WRIST" in last_night_problem(conn, date(2026, 9, 8))
    assert "MANUAL" in last_night_problem(conn, date(2026, 9, 10))
