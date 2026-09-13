"""Synthetic Garmin export so Phases 0-2 can run before the real zip lands (SPEC §12).

    python -m loader.make_fixture --out raw/fixture

Field names and units mirror Garmin's documented export shapes (seconds for
sleep stages, milliseconds for activity duration, centimetres for distance).
The last week is pinned by hand so the demo and the eval ground truth always
have the same interesting material: a hard run, a poor night, an off-wrist
night, a resting-HR bump and an HRV gap.
"""

from __future__ import annotations

import argparse
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

AS_OF = date(2026, 9, 13)
# Long-run anchors for the mean-reverting walks; the pinned week below then
# departs from them, which is exactly what makes the readiness call interesting.
RESTING_HR_ANCHOR = 54.0
HRV_ANCHOR = 47.0
DAYS = 180
SEED = 20260913

# date -> overrides applied after the random walk (SPEC demo material).
PINNED: dict[date, dict[str, Any]] = {
    date(2026, 9, 7): {"sleep_score": 81, "validation": "ENHANCED_FINAL", "resting_hr": 53, "hrv": 48},
    date(2026, 9, 8): {"sleep_score": 63, "validation": "OFF_WRIST", "resting_hr": 54, "hrv": 46},
    date(2026, 9, 9): {"sleep_score": 77, "validation": "ENHANCED_FINAL", "resting_hr": 54, "hrv": 45},
    date(2026, 9, 10): {"sleep_score": 58, "validation": "MANUAL", "resting_hr": 56, "hrv": 43},
    date(2026, 9, 11): {"sleep_score": 71, "validation": "ENHANCED_FINAL", "resting_hr": 56, "hrv": None},
    date(2026, 9, 12): {"sleep_score": 69, "validation": "ENHANCED_TENTATIVE", "resting_hr": 57, "hrv": 42},
    date(2026, 9, 13): {"sleep_score": 74, "validation": "ENHANCED_FINAL", "resting_hr": 58, "hrv": 41},
}

# The final two weeks are scripted, not sampled: the demo and the eval ground
# truth both need a known training block (three hard sessions, one rest day).
# (kind, hour, duration_min, speed_kmh, avg_hr, aerobic_te, anaerobic_te, recovery_h)
PINNED_SESSIONS: dict[date, list[tuple[str, int, float, float, int, float, float, int]]] = {
    date(2026, 8, 31): [("walking", 18, 42, 5.1, 104, 1.6, 0.2, 6)],
    date(2026, 9, 1): [("running", 6, 38, 8.6, 141, 2.4, 0.6, 14)],
    date(2026, 9, 2): [("strength_training", 18, 55, 0.0, 122, 2.1, 3.2, 26)],
    date(2026, 9, 3): [("walking", 18, 36, 5.0, 101, 1.4, 0.2, 5)],
    date(2026, 9, 4): [("running", 6, 62, 10.4, 161, 3.6, 2.4, 30)],
    date(2026, 9, 5): [("walking", 18, 48, 5.3, 106, 1.7, 0.2, 7)],
    date(2026, 9, 6): [("cycling", 7, 95, 26.5, 139, 2.8, 0.6, 18)],
    date(2026, 9, 7): [("running", 6, 34, 8.2, 137, 2.2, 0.5, 12)],
    date(2026, 9, 8): [("strength_training", 18, 45, 0.0, 118, 1.9, 1.4, 14)],
    date(2026, 9, 9): [("walking", 18, 40, 5.2, 103, 1.5, 0.2, 6)],
    date(2026, 9, 10): [("running", 6, 35, 8.4, 139, 2.3, 0.6, 13)],
    date(2026, 9, 11): [],  # rest day
    date(2026, 9, 12): [("running", 6, 50, 11.3, 158, 4.6, 3.7, 42)],
    date(2026, 9, 13): [("walking", 18, 30, 5.0, 100, 1.2, 0.1, 4)],
}

ACTIVITY_MIX = [
    ("running", 0.34),
    ("walking", 0.30),
    ("strength_training", 0.18),
    ("cycling", 0.12),
    ("swimming", 0.06),
]


def _epoch_ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


def _pick_type(rng: random.Random) -> str:
    roll = rng.random()
    cumulative = 0.0
    for name, weight in ACTIVITY_MIX:
        cumulative += weight
        if roll <= cumulative:
            return name
    return "walking"


def _sample_session(rng: random.Random, index: int) -> tuple[str, int, float, float, int, float, float, int]:
    """One randomly generated session for the pre-demo history."""
    kind = _pick_type(rng)
    hour = 6 if index == 0 else 18
    hard = rng.random() < 0.28
    if kind == "running":
        duration_min = rng.uniform(45, 95) if hard else rng.uniform(25, 45)
        speed_kmh = rng.uniform(9.5, 11.5) if hard else rng.uniform(7.5, 9.2)
        avg_hr = int(rng.uniform(155, 168)) if hard else int(rng.uniform(132, 148))
    elif kind == "cycling":
        duration_min = rng.uniform(40, 100)
        speed_kmh = rng.uniform(22, 30)
        avg_hr = int(rng.uniform(125, 155))
    elif kind == "walking":
        duration_min = rng.uniform(20, 70)
        speed_kmh = rng.uniform(4.5, 5.8)
        avg_hr = int(rng.uniform(95, 115))
        hard = False
    elif kind == "swimming":
        duration_min = rng.uniform(25, 50)
        speed_kmh = rng.uniform(2.2, 3.0)
        avg_hr = int(rng.uniform(120, 145))
    else:  # strength_training
        duration_min = rng.uniform(30, 70)
        speed_kmh = 0.0
        avg_hr = int(rng.uniform(105, 130))

    aerobic_te = round(rng.uniform(3.0, 4.6) if hard else rng.uniform(1.2, 2.9), 1)
    anaerobic_te = round(rng.uniform(2.0, 3.8) if hard and kind != "walking" else rng.uniform(0.0, 1.4), 1)
    recovery_hours = int(rng.uniform(24, 48)) if hard else int(rng.uniform(6, 20))
    return kind, hour, duration_min, speed_kmh, avg_hr, aerobic_te, anaerobic_te, recovery_hours


def build(as_of: date = AS_OF, days: int = DAYS, seed: int = SEED) -> dict[str, list[dict[str, Any]]]:
    rng = random.Random(seed)
    start = as_of - timedelta(days=days - 1)

    daily, sleep, hrv, activities, metrics = [], [], [], [], []
    activity_id = 9_000_000_000
    resting_baseline = 54.0
    hrv_baseline = 47.0

    for offset in range(days):
        day = start + timedelta(days=offset)
        pin = PINNED.get(day, {})

        # --- activities -------------------------------------------------------
        if day in PINNED_SESSIONS:
            sessions = PINNED_SESSIONS[day]
        else:
            sessions = [_sample_session(rng, index) for index in range(
                rng.choices([0, 1, 2], weights=[0.25, 0.6, 0.15])[0]
            )]

        day_load = 0.0
        for kind, hour, duration_min, speed_kmh, avg_hr, aerobic_te, anaerobic_te, recovery_hours in sessions:
            started = datetime(day.year, day.month, day.day, hour, rng.randrange(0, 50))
            distance_km = duration_min / 60 * speed_kmh
            day_load += aerobic_te
            activity_id += 1
            activities.append({
                "activityId": activity_id,
                "startTimeLocal": started.strftime("%Y-%m-%d %H:%M:%S"),
                "beginTimestamp": _epoch_ms(started),
                "activityType": kind,
                "duration": int(duration_min * 60_000),
                "distance": int(distance_km * 100_000),
                "avgHr": avg_hr,
                "maxHr": avg_hr + int(rng.uniform(8, 22)),
                "calories": int(duration_min * rng.uniform(7, 12)),
                "aerobicTrainingEffect": round(aerobic_te, 1),
                "anaerobicTrainingEffect": round(anaerobic_te, 1),
                "activityRecoveryHours": recovery_hours,
                "avgSpeed": int(speed_kmh / 0.036),
                "elevationGain": int(rng.uniform(0, 12000)) if kind in ("running", "cycling") else 0,
                "deviceId": 3_112_004_477,
            })

        # --- daily wellness ---------------------------------------------------
        # Mean-reverting walk: without the pull term the series drifts and the
        # 30-day baseline stops being a baseline.
        resting_baseline += (
            rng.gauss(0, 0.35) + 0.25 * (RESTING_HR_ANCHOR - resting_baseline) + 0.05 * (day_load - 2.0)
        )
        resting_baseline = min(max(resting_baseline, 48.0), 62.0)
        resting_hr = pin.get("resting_hr") or int(round(resting_baseline))
        steps = int(rng.gauss(9200, 2400) + day_load * 400)
        stress = int(min(max(rng.gauss(32, 9) + day_load * 2, 10), 85))
        body_high = int(min(max(rng.gauss(78, 9), 40), 100))
        body_low = int(min(max(body_high - rng.uniform(25, 60), 5), body_high - 5))

        daily.append({
            "calendarDate": day.isoformat(),
            "restingHeartRate": resting_hr,
            "minHeartRate": resting_hr - rng.randrange(2, 6),
            "maxHeartRate": 120 + rng.randrange(10, 60),
            "totalSteps": max(steps, 600),
            "moderateIntensityMinutes": int(max(rng.gauss(22, 12), 0)),
            "vigorousIntensityMinutes": int(max(rng.gauss(9, 8), 0)),
            "averageStressLevel": stress,
            "bodyBatteryHighestValue": body_high,
            "bodyBatteryLowestValue": body_low,
            "activeKilocalories": int(max(rng.gauss(520, 180) + day_load * 60, 120)),
            "userProfilePK": 1234567,
        })

        # --- sleep ------------------------------------------------------------
        validation = pin.get("validation") or rng.choices(
            ["ENHANCED_CONFIRMED_FINAL", "ENHANCED_TENTATIVE", "OFF_WRIST", "MANUAL"],
            weights=[0.82, 0.1, 0.05, 0.03],
        )[0]
        if validation == "OFF_WRIST":
            total_min = 0.0
            deep = light = rem = awake = 0.0
            score = None
        else:
            total_min = max(rng.gauss(410, 45), 240)
            deep = total_min * rng.uniform(0.11, 0.20)
            rem = total_min * rng.uniform(0.16, 0.26)
            light = total_min - deep - rem
            awake = rng.uniform(8, 40)
            score = pin.get("sleep_score") or int(min(max(rng.gauss(74, 11), 35), 96))
        bedtime = datetime(day.year, day.month, day.day, 23, rng.randrange(0, 59)) - timedelta(days=1)
        sleep.append({
            "calendarDate": day.isoformat(),
            "sleepStartTimestampLocal": bedtime.strftime("%Y-%m-%d %H:%M:%S"),
            "sleepEndTimestampLocal": (bedtime + timedelta(minutes=total_min + awake)).strftime("%Y-%m-%d %H:%M:%S"),
            "sleepTimeSeconds": int(total_min * 60),
            "deepSleepSeconds": int(deep * 60),
            "lightSleepSeconds": int(light * 60),
            "remSleepSeconds": int(rem * 60),
            "awakeSleepSeconds": int(awake * 60),
            "sleepScores": {"overall": {"value": score, "qualifierKey": "FAIR"}},
            "spo2SleepSummary": {"averageSPO2": round(rng.uniform(93.5, 97.5), 1)},
            "averageRespirationValue": round(rng.uniform(12.5, 16.5), 1),
            "sleepWindowConfirmationType": validation,
        })

        # --- HRV (device occasionally records nothing) ------------------------
        hrv_baseline += rng.gauss(0, 0.8) + 0.25 * (HRV_ANCHOR - hrv_baseline)
        hrv_baseline = min(max(hrv_baseline, 38.0), 56.0)
        last_night = pin["hrv"] if "hrv" in pin else (
            None if rng.random() < 0.06 else int(round(hrv_baseline + rng.gauss(0, 3)))
        )
        if last_night is not None:
            recent = [r["lastNightAvg"] for r in hrv[-7:] if r.get("lastNightAvg")]
            weekly = int(round(sum(recent + [last_night]) / (len(recent) + 1)))
            low, high = 43, 52
            if last_night < low:
                status = "UNBALANCED" if last_night >= low - 5 else "LOW"
            elif last_night > high:
                status = "UNBALANCED"
            else:
                status = "BALANCED"
            hrv.append({
                "calendarDate": day.isoformat(),
                "lastNightAvg": last_night,
                "lastNight5MinHigh": last_night + rng.randrange(8, 20),
                "weeklyAvg": weekly,
                "status": status,
                "baseline": {"balancedLow": low, "balancedUpper": high, "lowUpper": low - 4, "markerValue": 0.46},
            })

        # --- VO2 max / fitness age (weekly) -----------------------------------
        if offset % 7 == 0:
            metrics.append({
                "calendarDate": day.isoformat(),
                "vo2MaxPreciseValue": round(43.0 + offset * 0.012 + rng.gauss(0, 0.25), 1),
                "fitnessAge": round(32.0 - offset * 0.006 + rng.gauss(0, 0.2), 1),
            })

    return {"daily": daily, "sleep": sleep, "hrv": hrv, "activities": activities, "metrics": metrics}


def write(out: Path, data: dict[str, list[dict[str, Any]]]) -> list[Path]:
    connect_root = out / "DI_CONNECT"
    layout = {
        connect_root / "DI-Connect-Aggregator" / "UDSFile_2026-03-18_2026-09-13.json": data["daily"],
        connect_root / "DI-Connect-Wellness" / "2026-09-13_sleepData.json": data["sleep"],
        connect_root / "DI-Connect-Wellness" / "HRV_2026-09-13.json": data["hrv"],
        # Garmin wraps activities in a single-key envelope; keep that shape.
        connect_root / "DI-Connect-Fitness" / "fitness_summarizedActivities.json":
            [{"summarizedActivitiesExport": data["activities"]}],
        connect_root / "DI-Connect-Metrics" / "MetricsMaxMetData_2026.json": data["metrics"],
    }
    written = []
    for path, payload in layout.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=1))
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("raw/fixture"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=AS_OF)
    parser.add_argument("--days", type=int, default=DAYS)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    data = build(args.as_of, args.days, args.seed)
    for path in write(args.out, data):
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
