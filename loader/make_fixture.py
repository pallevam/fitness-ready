"""Synthetic Garmin export, calibrated to this account's real training profile.

    python -m loader.make_fixture --out raw/fixture

Why synthetic at all, now that the real export has arrived: the real data has no
HRV and no scored sleep after 2026-03-02, because the watch is not worn
overnight, so it cannot exercise the readiness rubric in SPEC §8. This fixture
models **the data we expect to have once the watch is worn overnight and the API
pull runs** -- the same person, the same sports, the same intensities, plus the
sleep and HRV that are currently missing.

Everything in PROFILE and the DAILY_* / SLEEP_* constants was measured from
wearable-real.duckdb on 15 Sep 2026, so the numbers an agent sees here are this
person's numbers, not a generic runner's.

Shapes match the account export (milliseconds, centimetres, kilojoules,
hrTimeInZone_*), plus the training-effect and recovery fields that Garmin
Connect's API supplies and the export omits.
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

AS_OF = date(2026, 9, 13)
DAYS = 180
SEED = 20260913

# Heart-rate zones for this profile, from the export's heartRateZones.json.
ZONE_FLOORS = (0, 96, 115, 134, 153, 172)   # zone_1..zone_5 floors; zone_0 is below 96
MAX_HR = 191

# Resting HR anchored to the *overnight-worn* mean (58.3), not the all-days mean
# (62.7). The gap between those two is a measurement artifact of not wearing the
# watch at night, and this fixture assumes it is worn.
RESTING_HR_ANCHOR = 57.5

# The real account has no usable HRV baseline: its only readings are 13
# ONBOARDING samples between 46 and 68. This band is consistent with those and
# with a resting HR in the high 50s.
HRV_ANCHOR = 57.0
HRV_BASELINE_LOW = 50
HRV_BASELINE_HIGH = 65

# Daily wellness, measured over 2026.
DAILY_STEPS = (6174, 2300)          # (mean, sd)
DAILY_ACTIVE_KCAL = (310, 120)
DAILY_INTENSITY_MIN = (54, 22)
DAILY_STRESS = (35, 9)
DAILY_BB_HIGH = (61, 10)
DAILY_BB_DRAIN = (40, 12)

# Sleep, measured over the 32 scored nights the account does have. Short nights
# (5.7 h mean) are this person's reality; the fixture keeps them rather than
# inventing eight-hour sleeps that would make every readiness call green.
SLEEP_TOTAL_MIN = (348, 45)
SLEEP_SCORE = (71, 10)
SLEEP_DEEP_FRACTION = (0.26, 0.05)
SLEEP_REM_FRACTION = (0.17, 0.04)
SLEEP_RESPIRATION = (15.0, 1.2)
SLEEP_SPO2 = (95.5, 1.2)

VO2MAX_START = 46.0
FITNESS_AGE_START = 30.0


@dataclass(frozen=True)
class ActivityProfile:
    """Per-sport parameters measured from the real export (medians and spreads)."""

    weight: float           # share of all sessions
    duration: tuple[float, float]
    avg_hr: tuple[float, float]
    zone4_minutes: tuple[float, float]   # (typical, ceiling)
    speed_kmh: float                     # 0 for sports with no meaningful distance


# Shares: strength 55%, walking 19%, badminton 17%, running and cycling 3% each.
PROFILE: dict[str, ActivityProfile] = {
    "strength_training": ActivityProfile(0.555, (50.5, 15.5), (112, 9), (0.8, 20.0), 0.0),
    "walking":           ActivityProfile(0.192, (25.0, 12.0), (94, 8), (0.0, 0.2), 4.7),
    "badminton":         ActivityProfile(0.171, (56.0, 15.8), (135, 10), (18.4, 38.7), 0.1),
    "running":           ActivityProfile(0.033, (64.3, 24.6), (138, 12), (19.1, 49.6), 6.9),
    "cycling":           ActivityProfile(0.033, (73.3, 31.0), (129, 11), (1.2, 26.1), 19.1),
    "indoor_cardio":     ActivityProfile(0.012, (15.9, 11.6), (100, 9), (0.2, 0.4), 0.0),
    "yoga":              ActivityProfile(0.004, (28.7, 8.0), (83, 6), (0.0, 0.0), 0.0),
}

# Sessions per day: 245 activities over ~600 days of real history.
SESSIONS_PER_DAY = (0.0, 1.0, 2.0)
SESSION_WEIGHTS = (0.42, 0.48, 0.10)

# The final two weeks are scripted so the demo and the eval ground truth always
# find the same material: three hard sessions, a rest day, a poor night, an
# off-wrist night, an HRV gap, and a resting-HR drift upward.
# (sport, hour, duration_min, zone4_min)
PINNED_SESSIONS: dict[date, list[tuple[str, int, float, float]]] = {
    date(2026, 8, 31): [("strength_training", 18, 52, 1.0)],
    date(2026, 9, 1):  [("walking", 18, 28, 0.0)],
    date(2026, 9, 2):  [("badminton", 19, 61, 22.4)],          # hard
    date(2026, 9, 3):  [("strength_training", 18, 48, 0.6)],
    date(2026, 9, 4):  [("running", 6, 58, 21.3)],             # hard
    date(2026, 9, 5):  [("walking", 18, 31, 0.0)],
    date(2026, 9, 6):  [("badminton", 10, 54, 12.1)],
    date(2026, 9, 7):  [("strength_training", 18, 55, 2.2)],
    date(2026, 9, 8):  [("walking", 18, 24, 0.0)],
    date(2026, 9, 9):  [("strength_training", 18, 50, 0.9)],
    date(2026, 9, 10): [("walking", 18, 33, 0.0)],
    date(2026, 9, 11): [],                                      # rest day
    date(2026, 9, 12): [("badminton", 19, 68, 28.6)],          # hard; drives readiness
    date(2026, 9, 13): [("walking", 18, 26, 0.0)],
}

# Sleep, HRV and resting HR for the demo week (SPEC §8: one amber/red call).
PINNED_WELLNESS: dict[date, dict[str, Any]] = {
    date(2026, 9, 7):  {"sleep_score": 78, "validation": "ENHANCED_FINAL", "resting_hr": 56, "hrv": 61},
    date(2026, 9, 8):  {"sleep_score": None, "validation": "OFF_WRIST", "resting_hr": 57, "hrv": 59},
    date(2026, 9, 9):  {"sleep_score": 74, "validation": "ENHANCED_FINAL", "resting_hr": 57, "hrv": 57},
    date(2026, 9, 10): {"sleep_score": 62, "validation": "MANUALLY_CONFIRMED", "resting_hr": 58, "hrv": 55},
    date(2026, 9, 11): {"sleep_score": 70, "validation": "ENHANCED_FINAL", "resting_hr": 59, "hrv": None},
    date(2026, 9, 12): {"sleep_score": 68, "validation": "ENHANCED_TENTATIVE", "resting_hr": 60, "hrv": 52},
    date(2026, 9, 13): {"sleep_score": 72, "validation": "ENHANCED_FINAL", "resting_hr": 61, "hrv": 48},
}

KJ_PER_KCAL = 4.184


def _epoch_ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _pick_sport(rng: random.Random) -> str:
    return rng.choices(list(PROFILE), weights=[p.weight for p in PROFILE.values()])[0]


def _zone_split(rng: random.Random, duration_min: float, zone4_min: float) -> list[int]:
    """Spread a session across the seven HR zones, in milliseconds.

    Garmin's zones sum to the activity duration, which is how `hard_minutes` is
    derived in loader.load_garmin. Zone 4+ time is fixed by the caller; the rest
    is distributed with a warm-up-shaped bias toward the middle zones.
    """
    zone4_min = _clamp(zone4_min, 0.0, duration_min * 0.8)
    remaining = duration_min - zone4_min
    # Lower zones: most time in 2 and 3 for anything structured.
    shares = [rng.uniform(0.05, 0.12), rng.uniform(0.08, 0.16),
              rng.uniform(0.30, 0.42), rng.uniform(0.35, 0.50)]
    total = sum(shares)
    lower = [remaining * share / total for share in shares]
    # Split zone 4+ between 4 and 5; zone 6 stays empty for this profile.
    zone5 = zone4_min * rng.uniform(0.15, 0.4) if zone4_min > 5 else 0.0
    zone4 = zone4_min - zone5
    minutes = lower + [zone4, zone5, 0.0]
    return [int(round(m * 60_000)) for m in minutes]


def _make_activity(
    rng: random.Random, activity_id: int, day: date, sport: str,
    hour: int, duration_min: float, zone4_min: float,
) -> dict[str, Any]:
    profile = PROFILE[sport]
    started = datetime(day.year, day.month, day.day, hour, rng.randrange(0, 50))
    avg_hr = int(_clamp(rng.gauss(*profile.avg_hr) + zone4_min * 0.15, 70, 172))
    peak_hr = int(_clamp(avg_hr + rng.uniform(15, 45), avg_hr + 5, MAX_HR))
    distance_km = duration_min / 60 * profile.speed_kmh * rng.uniform(0.9, 1.1)
    zones = _zone_split(rng, duration_min, zone4_min)

    # Energy: the export reports kilojoules (SPEC implementation note).
    kcal = duration_min * rng.uniform(5.5, 7.5) * (1 + zone4_min / 60)
    # Training effect and recovery come from the API, not the export; they scale
    # with time spent at or above zone 4.
    aerobic_te = round(_clamp(1.0 + zone4_min * 0.11 + rng.gauss(0, 0.2), 0.5, 5.0), 1)
    anaerobic_te = round(_clamp(zone4_min * 0.06 + rng.gauss(0, 0.15), 0.0, 5.0), 1)
    recovery_hours = int(_clamp(6 + zone4_min * 1.3 + rng.gauss(0, 3), 4, 72))

    return {
        "activityId": activity_id,
        "startTimeLocal": started.strftime("%Y-%m-%d %H:%M:%S"),
        "beginTimestamp": _epoch_ms(started),
        "activityType": sport,
        "duration": int(duration_min * 60_000),
        "distance": int(distance_km * 100_000),
        "avgHr": avg_hr,
        "maxHr": peak_hr,
        "calories": round(kcal * KJ_PER_KCAL, 2),
        "bmrCalories": round(duration_min * 1.45 * KJ_PER_KCAL, 2),
        "aerobicTrainingEffect": aerobic_te,
        "anaerobicTrainingEffect": anaerobic_te,
        "activityRecoveryHours": recovery_hours,
        # The export stores speed in decametres per second: km/h / 36 (fieldmap.damps_to_kmh).
        "avgSpeed": round(profile.speed_kmh / 36.0, 4) if profile.speed_kmh else 0,
        "elevationGain": int(rng.uniform(0, 9000)) if sport in ("running", "cycling") else 0,
        **{f"hrTimeInZone_{index}": float(value) for index, value in enumerate(zones)},
        "deviceId": 3_494_295_084,
    }


def _sample_session(rng: random.Random) -> tuple[str, int, float, float]:
    sport = _pick_sport(rng)
    profile = PROFILE[sport]
    duration = _clamp(rng.gauss(*profile.duration), 12, 150)
    typical, ceiling = profile.zone4_minutes
    if ceiling <= 0.2:
        zone4 = 0.0
    else:
        # Long tail: most sessions sit near the median, a few reach the ceiling.
        zone4 = _clamp(abs(rng.gauss(typical, max(typical, 4) * 0.8)), 0.0, ceiling)
    hour = 6 if sport == "running" else (19 if sport == "badminton" else 18)
    return sport, hour, duration, zone4


def build(as_of: date = AS_OF, days: int = DAYS, seed: int = SEED) -> dict[str, list[dict[str, Any]]]:
    rng = random.Random(seed)
    start = as_of - timedelta(days=days - 1)

    daily, sleep, hrv, activities, metrics = [], [], [], [], []
    activity_id = 9_000_000_000
    resting_baseline = RESTING_HR_ANCHOR
    hrv_baseline = HRV_ANCHOR

    for offset in range(days):
        day = start + timedelta(days=offset)
        pinned = PINNED_WELLNESS.get(day, {})

        # --- activities -------------------------------------------------------
        if day in PINNED_SESSIONS:
            sessions = PINNED_SESSIONS[day]
        else:
            count = int(rng.choices(SESSIONS_PER_DAY, weights=SESSION_WEIGHTS)[0])
            sessions = [_sample_session(rng) for _ in range(count)]

        day_zone4 = 0.0
        for sport, hour, duration_min, zone4_min in sessions:
            activity_id += 1
            day_zone4 += zone4_min
            activities.append(
                _make_activity(rng, activity_id, day, sport, hour, duration_min, zone4_min)
            )

        # --- daily wellness ---------------------------------------------------
        # Mean-reverting walk, nudged up by yesterday's hard work.
        resting_baseline += (
            rng.gauss(0, 0.3) + 0.25 * (RESTING_HR_ANCHOR - resting_baseline) + 0.02 * day_zone4
        )
        resting_baseline = _clamp(resting_baseline, 52.0, 66.0)
        resting_hr = pinned.get("resting_hr") or int(round(resting_baseline))
        stress = int(_clamp(rng.gauss(*DAILY_STRESS) + day_zone4 * 0.25, 12, 88))
        bb_high = int(_clamp(rng.gauss(*DAILY_BB_HIGH), 30, 100))
        bb_low = int(_clamp(bb_high - abs(rng.gauss(*DAILY_BB_DRAIN)), 5, bb_high - 4))
        moderate = int(_clamp(rng.gauss(*DAILY_INTENSITY_MIN) * 0.6, 0, 200))
        vigorous = int(_clamp(day_zone4 * 0.8 + rng.gauss(4, 4), 0, 120))

        daily.append({
            "calendarDate": day.isoformat(),
            "restingHeartRate": resting_hr,
            "minHeartRate": resting_hr - rng.randrange(1, 5),
            "maxHeartRate": int(_clamp(rng.gauss(125, 18) + day_zone4, 95, MAX_HR)),
            "totalSteps": int(_clamp(rng.gauss(*DAILY_STEPS) + day_zone4 * 60, 800, 30000)),
            "moderateIntensityMinutes": moderate,
            "vigorousIntensityMinutes": vigorous,
            "activeKilocalories": int(_clamp(rng.gauss(*DAILY_ACTIVE_KCAL) + day_zone4 * 6, 80, 2000)),
            # Nested exactly as the real export delivers them.
            "allDayStress": {
                "calendarDate": day.isoformat(),
                "aggregatorList": [
                    {"type": "TOTAL", "averageStressLevel": stress, "maxStressLevel": min(99, stress + 40)},
                    {"type": "AWAKE", "averageStressLevel": stress + rng.randrange(0, 4)},
                ],
            },
            "bodyBattery": {
                "calendarDate": day.isoformat(),
                "bodyBatteryStatList": [
                    {"bodyBatteryStatType": "HIGHEST", "statsValue": bb_high},
                    {"bodyBatteryStatType": "LOWEST", "statsValue": bb_low},
                    {"bodyBatteryStatType": "MOSTRECENT", "statsValue": bb_low + 3},
                ],
            },
            "userProfilePK": 129730779,
        })

        # --- sleep ------------------------------------------------------------
        validation = pinned.get("validation") or rng.choices(
            ["ENHANCED_CONFIRMED_FINAL", "ENHANCED_TENTATIVE", "OFF_WRIST", "MANUALLY_CONFIRMED"],
            weights=[0.84, 0.09, 0.05, 0.02],
        )[0]
        if validation == "OFF_WRIST":
            total_min = awake = deep = light = rem = 0.0
            score = None
        else:
            total_min = _clamp(rng.gauss(*SLEEP_TOTAL_MIN) - day_zone4 * 0.3, 210, 520)
            deep = total_min * _clamp(rng.gauss(*SLEEP_DEEP_FRACTION), 0.08, 0.35)
            rem = total_min * _clamp(rng.gauss(*SLEEP_REM_FRACTION), 0.08, 0.30)
            light = total_min - deep - rem
            awake = rng.uniform(10, 45)
            score = pinned.get("sleep_score")
            if score is None and "sleep_score" not in pinned:
                score = int(_clamp(rng.gauss(*SLEEP_SCORE), 35, 95))

        bedtime = datetime(day.year, day.month, day.day, 23, rng.randrange(0, 59)) - timedelta(days=1)
        sleep.append({
            "calendarDate": day.isoformat(),
            "sleepStartTimestampLocal": bedtime.strftime("%Y-%m-%d %H:%M:%S"),
            "sleepEndTimestampLocal":
                (bedtime + timedelta(minutes=total_min + awake)).strftime("%Y-%m-%d %H:%M:%S"),
            "sleepTimeSeconds": int(total_min * 60),
            "deepSleepSeconds": int(deep * 60),
            "lightSleepSeconds": int(light * 60),
            "remSleepSeconds": int(rem * 60),
            "awakeSleepSeconds": int(awake * 60),
            "sleepScores": {"overall": {"value": score, "qualifierKey": "FAIR"}},
            "spo2SleepSummary": {"averageSPO2": round(rng.gauss(*SLEEP_SPO2), 1)},
            "averageRespirationValue": round(rng.gauss(*SLEEP_RESPIRATION), 1),
            "sleepWindowConfirmationType": validation,
            "retro": False,
        })

        # --- HRV --------------------------------------------------------------
        hrv_baseline += rng.gauss(0, 0.9) + 0.25 * (HRV_ANCHOR - hrv_baseline) - 0.02 * day_zone4
        hrv_baseline = _clamp(hrv_baseline, 44.0, 70.0)
        if "hrv" in pinned:
            last_night = pinned["hrv"]
        else:
            last_night = None if rng.random() < 0.05 else int(round(hrv_baseline + rng.gauss(0, 2.5)))
        if last_night is not None:
            recent = [row["lastNightAvg"] for row in hrv[-7:] if row.get("lastNightAvg")]
            if last_night < HRV_BASELINE_LOW:
                status = "UNBALANCED" if last_night >= HRV_BASELINE_LOW - 6 else "LOW"
            elif last_night > HRV_BASELINE_HIGH:
                status = "UNBALANCED"
            else:
                status = "BALANCED"
            hrv.append({
                "calendarDate": day.isoformat(),
                "lastNightAvg": last_night,
                "lastNight5MinHigh": last_night + rng.randrange(8, 22),
                "weeklyAvg": int(round(sum(recent + [last_night]) / (len(recent) + 1))),
                "status": status,
                "baseline": {
                    "balancedLow": HRV_BASELINE_LOW,
                    "balancedUpper": HRV_BASELINE_HIGH,
                    "lowUpper": HRV_BASELINE_LOW - 5,
                    "markerValue": 0.47,
                },
            })

        # --- VO2 max / fitness age (weekly, as the export delivers them) ------
        if offset % 7 == 0:
            metrics.append({
                "calendarDate": day.isoformat(),
                "asOfDateGmt": f"{day.isoformat()}T00:00:00.0",
                "vo2MaxPreciseValue": round(VO2MAX_START + offset * 0.004 + rng.gauss(0, 0.2), 1),
                "currentBioAge": round(FITNESS_AGE_START - offset * 0.003 + rng.gauss(0, 0.15), 1),
                "chronologicalAge": 31,
            })

    return {"daily": daily, "sleep": sleep, "hrv": hrv, "activities": activities, "metrics": metrics}


def write(out: Path, data: dict[str, list[dict[str, Any]]]) -> list[Path]:
    connect_root = out / "DI_CONNECT"
    layout = {
        connect_root / "DI-Connect-Aggregator" / "UDSFile_2026-03-18_2026-09-13.json": data["daily"],
        connect_root / "DI-Connect-Wellness" / "2026-03-18_2026-09-13_sleepData.json": data["sleep"],
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
