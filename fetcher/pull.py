"""Stage 2: pull a date range from Garmin Connect into loader-ready files.

    python -m fetcher.pull                          # the last 30 days
    python -m fetcher.pull --start 2026-08-01 --end 2026-09-16
    python -m loader.load_garmin raw/api --db wearable-real.duckdb

Layout under --out (default raw/api/, gitignored):

    api-responses/<endpoint>/<day>.json      the response exactly as Garmin sent it
    garmin-api-<table>/<endpoint>_<day>.json  what fetcher.normalise made of it

Only the second tree is loaded (loader.discovery ignores the first). Records
are always rebuilt from the saved responses, so a fix to the normaliser applies
to history without calling Garmin again.

Incremental: a day whose response is on disk is not fetched again, except the
most recent days (Garmin finalises sleep and HRV late) or with --force. A
failed call is logged and left missing, so the next run retries it.
"""

from __future__ import annotations

import argparse
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fetcher.client import FetcherError, connect
from fetcher.endpoints import ENDPOINTS, Endpoint
from fetcher.normalise import activity_day, normalise

log = logging.getLogger("fetcher.pull")

DEFAULT_OUT = Path("raw/api")
DEFAULT_DAYS = 30
REFETCH_RECENT_DAYS = 2
MAX_DAYS = 366


@dataclass
class PullStats:
    fetched: Counter[str] = field(default_factory=Counter)
    reused: Counter[str] = field(default_factory=Counter)
    failed: list[str] = field(default_factory=list)
    records: Counter[str] = field(default_factory=Counter)


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def response_path(out: Path, endpoint: Endpoint, day: date) -> Path:
    return out / "api-responses" / endpoint.name / f"{day.isoformat()}.json"


def record_path(out: Path, endpoint: Endpoint, day: date) -> Path:
    return out / f"garmin-api-{endpoint.table}" / f"{endpoint.name}_{day.isoformat()}.json"


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, default=str))


def needs_fetch(path: Path, day: date, today: date, force: bool,
                recent_days: int = REFETCH_RECENT_DAYS) -> bool:
    if force or not path.exists():
        return True
    return day > today - timedelta(days=recent_days)


def _fetch_per_day(session, endpoint: Endpoint, days: list[date], out: Path,
                   today: date, force: bool, stats: PullStats) -> None:
    for day in days:
        path = response_path(out, endpoint, day)
        if not needs_fetch(path, day, today, force):
            stats.reused[endpoint.name] += 1
            continue
        try:
            payload = session.call(endpoint.method, day.isoformat())
        except FetcherError as error:
            log.error("%s %s failed: %s", endpoint.name, day, error)
            stats.failed.append(f"{endpoint.name} {day}")
            continue
        _write_json(path, payload)
        stats.fetched[endpoint.name] += 1


def _fetch_activities(session, endpoint: Endpoint, days: list[date], out: Path,
                      today: date, force: bool, stats: PullStats) -> None:
    """One ranged call for every day that needs it, split back into per-day files."""
    wanted = [day for day in days if needs_fetch(response_path(out, endpoint, day), day, today, force)]
    stats.reused[endpoint.name] += len(days) - len(wanted)
    if not wanted:
        return
    first, last = min(wanted), max(wanted)
    try:
        payload = session.call(endpoint.method, first.isoformat(), last.isoformat())
    except FetcherError as error:
        log.error("%s %s..%s failed: %s", endpoint.name, first, last, error)
        stats.failed.extend(f"{endpoint.name} {day}" for day in wanted)
        return
    by_day: dict[date, list[Any]] = {}
    for item in payload or []:
        day = activity_day(item) if isinstance(item, dict) else None
        if day is None:
            log.warning("activity %s has no usable startTimeLocal; skipped",
                        (item or {}).get("activityId") if isinstance(item, dict) else item)
            continue
        by_day.setdefault(day, []).append(item)
    # Every requested day inside the fetched span is now known, including the empty ones.
    requested = set(days)
    for day in days_between(first, last):
        if day in requested:
            _write_json(response_path(out, endpoint, day), by_day.get(day, []))
            stats.fetched[endpoint.name] += 1


def build_records(out: Path, days: list[date], stats: PullStats) -> None:
    for endpoint in ENDPOINTS:
        for day in days:
            source = response_path(out, endpoint, day)
            target = record_path(out, endpoint, day)
            if not source.exists():
                continue
            records = normalise(endpoint.name, json.loads(source.read_text()), day)
            if records:
                _write_json(target, records)
                stats.records[endpoint.table] += len(records)
            elif target.exists():
                target.unlink()  # a later response emptied a day we had before


def pull(session, start: date, end: date, out: Path, *, today: date | None = None,
         force: bool = False) -> PullStats:
    if end < start:
        raise ValueError("end must not be before start")
    days = days_between(start, end)
    if len(days) > MAX_DAYS:
        raise ValueError(f"{len(days)} days requested; pull at most {MAX_DAYS} at a time")
    today = today or date.today()
    stats = PullStats()
    for endpoint in ENDPOINTS:
        fetch = _fetch_per_day if endpoint.per_day else _fetch_activities
        fetch(session, endpoint, days, out, today, force, stats)
    build_records(out, days, stats)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", type=date.fromisoformat, default=None,
                        help=f"first day, YYYY-MM-DD (default: {DEFAULT_DAYS} days before --end)")
    parser.add_argument("--end", type=date.fromisoformat, default=date.today(),
                        help="last day, YYYY-MM-DD (default: today)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--force", action="store_true", help="re-fetch days already on disk")
    parser.add_argument("--email", default=None, help="overrides $GARMIN_EMAIL")
    parser.add_argument("--tokens", default=None, help="overrides $GARMIN_TOKENS")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
    )
    start = args.start or args.end - timedelta(days=DEFAULT_DAYS - 1)

    try:
        session = connect(email=args.email, token_dir=args.tokens)
        stats = pull(session, start, args.end, args.out, force=args.force)
    except (FetcherError, ValueError) as error:
        print(f"pull failed: {error}")
        return 1

    print(f"\npulled {start} .. {args.end} into {args.out}")
    for endpoint in ENDPOINTS:
        print(f"  {endpoint.name:<14} fetched {stats.fetched[endpoint.name]:>4}"
              f"  reused {stats.reused[endpoint.name]:>4}")
    print("records ready to load: "
          + (", ".join(f"{table} {count}" for table, count in sorted(stats.records.items())) or "none"))
    if stats.failed:
        print(f"\n{len(stats.failed)} calls failed and will be retried next run:")
        for item in stats.failed[:20]:
            print(f"  {item}")
    return 1 if stats.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
