"""Derived definitions from SPEC §6.3.

These are the single source of truth for "hard session", "resting HR delta",
"HRV vs baseline" and "sleep is trustworthy". The tools server, the eval ground
truth and the tests all import from here, so a definition can only change in one
place. Each rule is expressed twice -- once as a SQL fragment for DuckDB, once as
a Python predicate for row-level use -- and the tests assert the two agree.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Mapping, Sequence

# Tool contract (SPEC §7).
MAX_RANGE_DAYS = 365

# Rolling windows (SPEC §6.3).
RESTING_HR_WINDOW_DAYS = 30
HRV_SHORT_WINDOW_DAYS = 7
HRV_LONG_WINDOW_DAYS = 60

# Sleep the agent must not trust (SPEC §6.3).
UNTRUSTWORTHY_VALIDATIONS = ("OFF_WRIST", "MANUAL")

# `get_readiness_inputs` reports "hours ago" for the last hard session. Evals pin
# `as_of_date`, so the reference instant must not depend on wall-clock time:
# we anchor every as-of date to early evening, when the next day gets planned.
REFERENCE_HOUR = 18

# --- hard session ----------------------------------------------------------
HARD_SESSION_AEROBIC_TE = 3.0
HARD_SESSION_ANAEROBIC_TE = 3.0
HARD_SESSION_RECOVERY_HOURS = 24

# Training effect and recovery time are absent from the account export -- it
# carries only message enums like "IMPROVING_LACTATE_THRESHOLD_12", whose
# suffixes are message ids, not values. So the rule also accepts time at or
# above HR zone 4 (153 bpm on this profile), which every activity records.
# 20 minutes is the standard threshold for a genuinely hard session and marks
# 11% of the real history, concentrated in badminton and running.
HARD_SESSION_ZONE4_MINUTES = 20.0

HARD_SESSION_SQL = (
    f"(coalesce(aerobic_te, 0) >= {HARD_SESSION_AEROBIC_TE}"
    f" OR coalesce(anaerobic_te, 0) >= {HARD_SESSION_ANAEROBIC_TE}"
    f" OR coalesce(recovery_time_hours, 0) >= {HARD_SESSION_RECOVERY_HOURS}"
    f" OR coalesce(hard_minutes, 0) >= {HARD_SESSION_ZONE4_MINUTES})"
)


def is_hard_session(activity: Mapping[str, Any]) -> bool:
    """SPEC §6.3. Applies to every activity type, so strength and badminton count."""
    return (
        (activity.get("aerobic_te") or 0) >= HARD_SESSION_AEROBIC_TE
        or (activity.get("anaerobic_te") or 0) >= HARD_SESSION_ANAEROBIC_TE
        or (activity.get("recovery_time_hours") or 0) >= HARD_SESSION_RECOVERY_HOURS
        or (activity.get("hard_minutes") or 0) >= HARD_SESSION_ZONE4_MINUTES
    )


# --- sleep trust -----------------------------------------------------------
SLEEP_TRUSTWORTHY_SQL = (
    "(validation NOT IN ("
    + ", ".join(f"'{v}'" for v in UNTRUSTWORTHY_VALIDATIONS)
    + ") AND coalesce(total_min, 0) > 0)"
)


def is_sleep_trustworthy(validation: str | None, total_min: float | None) -> bool:
    """SPEC §6.3. A NULL validation is not trustworthy: we don't know how it was recorded."""
    if validation is None:
        return False
    return validation.upper() not in UNTRUSTWORTHY_VALIDATIONS and (total_min or 0) > 0


# --- resting HR ------------------------------------------------------------
def resting_hr_delta(today: int | None, trailing_mean: float | None) -> float | None:
    """Today's resting HR minus the trailing 30-day mean, excluding today."""
    if today is None or trailing_mean is None:
        return None
    return round(today - trailing_mean, 1)


# --- HRV -------------------------------------------------------------------
def hrv_vs_baseline(
    last_night_avg: int | None, baseline_low: int | None, baseline_high: int | None
) -> str:
    """Returns 'below' | 'within' | 'above' | 'unknown' relative to the baseline band."""
    if last_night_avg is None or baseline_low is None or baseline_high is None:
        return "unknown"
    if last_night_avg < baseline_low:
        return "below"
    if last_night_avg > baseline_high:
        return "above"
    return "within"


# --- helpers shared by the tool endpoints ----------------------------------
def reference_instant(as_of: date) -> datetime:
    return datetime.combine(as_of, time(hour=REFERENCE_HOUR))


def hours_between(earlier: datetime, later: datetime) -> float:
    return round((later - earlier).total_seconds() / 3600.0, 1)


def date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def missing_dates(start: date, end: date, present: Iterable[date]) -> list[date]:
    have = set(present)
    return [day for day in date_range(start, end) if day not in have]


def describe_gaps(label: str, missing: Sequence[date], *, max_listed: int = 5) -> list[str]:
    """Human-readable data gaps, e.g. "no HRV on 2026-09-11" (SPEC §7)."""
    if not missing:
        return []
    if len(missing) <= max_listed:
        return [f"no {label} on {day.isoformat()}" for day in missing]
    return [
        f"no {label} on {len(missing)} days between "
        f"{missing[0].isoformat()} and {missing[-1].isoformat()}"
    ]
