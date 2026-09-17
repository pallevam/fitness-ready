"""Stage 1: dump one day of raw API responses so we can read the real field names.

    python -m fetcher.probe --date 2026-09-13

Writes raw/api_samples/<endpoint>_<date>.json untouched -- no unwrapping, no
renaming -- and prints a shape report: top-level keys, envelope candidates, and
the activity fields whose units differ between the API and the account export
(SPEC §6.2 assumes export units).

Nothing is mapped or loaded from this output. It exists to be reviewed before
fetcher/normalise.py is written.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

from fetcher.client import FetcherError, connect
from fetcher.endpoints import ENDPOINTS

log = logging.getLogger("fetcher.probe")

DEFAULT_OUT = Path("raw/api_samples")

# Keys whose units differ between sources: the export gives these in ms / cm /
# dam-per-second, the API in s / m / m-per-second (fetcher.normalise renames them).
UNIT_SENSITIVE_KEYS = (
    "duration", "elapsedDuration", "movingDuration", "durationSeconds",
    "distance", "distanceMeters",
    "averageSpeed", "avgSpeed", "maxSpeed",
    "elevationGain", "elevationLoss",
)


def _describe(payload: Any, indent: str = "    ") -> list[str]:
    """Top-level shape of a response: keys, or list length and the first record's keys."""
    if payload is None:
        return [f"{indent}None (no data for this date)"]
    if isinstance(payload, list):
        lines = [f"{indent}list[{len(payload)}]"]
        if payload and isinstance(payload[0], dict):
            lines.append(f"{indent}first record keys: {', '.join(sorted(payload[0])[:24])}")
        return lines
    if isinstance(payload, dict):
        lines = [f"{indent}dict keys: {', '.join(sorted(payload)[:24])}"]
        for key, value in payload.items():
            # Envelope candidates: a key whose value holds the actual records.
            if isinstance(value, dict):
                lines.append(f"{indent}  envelope? {key} -> dict({', '.join(sorted(value)[:16])})")
            elif isinstance(value, list) and value and isinstance(value[0], dict):
                lines.append(
                    f"{indent}  envelope? {key} -> list[{len(value)}] "
                    f"({', '.join(sorted(value[0])[:16])})"
                )
        return lines
    return [f"{indent}{type(payload).__name__}: {payload!r}"]


def _unit_report(payload: Any) -> list[str]:
    """Print the raw values of unit-sensitive activity fields so we can eyeball them."""
    records = payload if isinstance(payload, list) else [payload]
    first = next((r for r in records if isinstance(r, dict)), None)
    if not first:
        return ["    (no activity on this date to inspect units with)"]
    lines = ["    unit-sensitive fields (compare against SPEC §6.2 export units):"]
    for key in UNIT_SENSITIVE_KEYS:
        if key in first:
            lines.append(f"      {key} = {first[key]!r}")
    lines.append(
        "      ^ a ~5 km run reads 5000 in metres, 500000 in centimetres;"
        " a 30 min session reads 1800 in seconds, 1800000 in milliseconds"
    )
    return lines


def probe(session, cdate: date, out_dir: Path) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    day = cdate.isoformat()
    results: dict[str, Any] = {}

    for endpoint in ENDPOINTS:
        args = (day,) if endpoint.per_day else (day, day)
        try:
            payload = session.call(endpoint.method, *args)
        except FetcherError as error:
            log.error("%-14s FAILED: %s", endpoint.name, error)
            results[endpoint.name] = None
            continue

        path = out_dir / f"{endpoint.name}_{day}.json"
        path.write_text(json.dumps(payload, indent=1, default=str))
        results[endpoint.name] = payload

        print(f"\n{endpoint.name}  ({endpoint.method} -> table {endpoint.table})")
        print(f"    {endpoint.note}")
        print(f"    wrote {path}")
        for line in _describe(payload):
            print(line)
        if endpoint.name == "activities":
            for line in _unit_report(payload):
                print(line)

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, default=date.today(),
                        help="day to sample, YYYY-MM-DD (default: today)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--email", default=None, help="overrides $GARMIN_EMAIL")
    parser.add_argument("--tokens", default=None, help="overrides $GARMIN_TOKENS")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
    )

    try:
        session = connect(email=args.email, token_dir=args.tokens)
    except FetcherError as error:
        print(f"login failed: {error}")
        return 1

    print(f"\nprobing {args.date.isoformat()} -> {args.out}")
    probe(session, args.date, args.out)
    print(
        "\nRaw responses are unmodified. If a field above is new, teach"
        "\nfetcher/normalise.py about it before running `make pull`."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
