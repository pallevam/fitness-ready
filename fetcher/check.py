"""After a sync, say whether last night made it in, in one line or not at all.

    python -m fetcher.check --db wearable-real.duckdb      # prints a problem, exit 1
                                                           # or nothing, exit 0

`scripts/daily_sync.sh` turns a non-empty answer into a macOS notification, so
a night the watch missed is noticed that morning rather than days later (the
5 Oct night went unnoticed for four days).

Sleep is dated by the wake day, so "last night" is the row dated today.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

import duckdb

from db import connect
from tools.derived import is_sleep_trustworthy


def last_night_problem(conn: duckdb.DuckDBPyConnection, today: date) -> str | None:
    row = conn.execute(
        "SELECT total_min, validation FROM sleep WHERE date = ?", [today]
    ).fetchone()
    if row is None:
        return (
            "No sleep for last night yet. Open Garmin Connect on the phone to upload it; "
            "if it is still missing after the next sync, the watch did not record it."
        )
    total_min, validation = row
    if not is_sleep_trustworthy(validation, total_min):
        return (
            f"Last night's sleep is recorded as {validation or 'unknown'} "
            f"({total_min or 0:.0f} min), so the coach will not trust it."
        )
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--today", type=date.fromisoformat, default=date.today())
    args = parser.parse_args(argv)
    with connect(args.db, read_only=True) as conn:
        problem = last_night_problem(conn, args.today)
    if problem:
        print(problem)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
