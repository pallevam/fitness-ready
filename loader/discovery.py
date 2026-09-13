"""File discovery and JSON shape handling for the Garmin export (SPEC §6.1).

Exact filenames vary by account, so everything here matches on *patterns* and on
observed record keys -- never on a hardcoded filename.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

# Table -> filename patterns (case-insensitive, matched against the path relative
# to the export root). Ordered: first pattern that hits wins for classification.
FILE_PATTERNS: dict[str, tuple[str, ...]] = {
    "sleep": (r"sleepdata", r"di-connect-wellness.*sleep"),
    "hrv": (r"hrv", r"heartratevariability"),
    "daily": (r"udsfile", r"dailysummar", r"aggregator.*uds"),
    "activities": (r"summarizedactivities", r"di-connect-fitness.*activit"),
    "user_metrics": (r"metricsmaxmet", r"metricsfitnessage", r"vo2", r"fitnessage"),
}

# Files we deliberately ignore in Phase 1 (SPEC §6.1).
IGNORE_PATTERNS: tuple[str, ...] = (
    r"uploadedfiles.*\.zip$",
    r"\.fit$",
    r"\.gpx$",
    r"\.tcx$",
)


@dataclass(frozen=True)
class SourceFile:
    path: Path
    table: str | None  # None => unclassified
    records: int


def _rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def classify(path: Path, root: Path) -> str | None:
    """Return the target table for a file, or None if we don't recognise it."""
    key = _rel(path, root).lower()
    if any(re.search(p, key) for p in IGNORE_PATTERNS):
        return None
    for table, patterns in FILE_PATTERNS.items():
        if any(re.search(p, key) for p in patterns):
            return table
    return None


def json_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.json") if p.is_file())


def iter_records(path: Path) -> Iterator[dict[str, Any]]:
    """Yield record dicts from a Garmin JSON file.

    Garmin ships at least three shapes:
      1. a top-level list of records,
      2. a top-level dict wrapping a single list (e.g. ``summarizedActivitiesExport``),
      3. a list of such wrapper dicts.
    Anything else is yielded as a single record if it looks like one.
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return
    yield from _walk(payload)


def _walk(node: Any, depth: int = 0) -> Iterator[dict[str, Any]]:
    if depth > 3:
        return
    if isinstance(node, list):
        for item in node:
            yield from _walk(item, depth + 1)
        return
    if not isinstance(node, dict):
        return
    # A wrapper dict is one whose only meaningful value is a list of dicts.
    list_values = [v for v in node.values() if isinstance(v, list) and v and isinstance(v[0], dict)]
    if list_values and len(node) <= 3:
        for value in list_values:
            yield from _walk(value, depth + 1)
        return
    yield node


def flatten(record: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten nested dicts to dotted keys so field specs can address them."""
    out: dict[str, Any] = {}
    for key, value in record.items():
        dotted = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, f"{dotted}."))
        else:
            out[dotted] = value
    return out
