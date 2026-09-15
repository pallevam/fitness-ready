"""The Garmin Connect calls we need, and nothing more (SPEC §3, §6.2).

One entry per table we populate. Training Readiness and Training Status are
absent on purpose: the vivoactive 5 does not produce them, so calling those
endpoints could only ever return something we must not use.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Endpoint:
    name: str          # our name; also the raw-sample filename stem
    method: str        # method on the garminconnect client
    table: str         # SPEC §6.2 table it feeds
    per_day: bool      # True => called with a single cdate
    note: str


# Ordered roughly by how central each one is to the readiness bundle (SPEC §7).
ENDPOINTS: tuple[Endpoint, ...] = (
    Endpoint(
        name="daily_summary", method="get_user_summary", table="daily", per_day=True,
        note="resting HR, steps, intensity minutes, stress, body battery",
    ),
    Endpoint(
        name="sleep", method="get_sleep_data", table="sleep", per_day=True,
        note="expects a dailySleepDTO envelope; carries the validation flag",
    ),
    Endpoint(
        name="hrv", method="get_hrv_data", table="hrv", per_day=True,
        note="expects an hrvSummary envelope; returns None on nights with no reading",
    ),
    Endpoint(
        name="activities", method="get_activities_by_date", table="activities", per_day=False,
        note="date range, not a single day; units are the API's, not the export's",
    ),
    Endpoint(
        name="max_metrics", method="get_max_metrics", table="user_metrics", per_day=True,
        note="VO2 max",
    ),
    Endpoint(
        name="fitness_age", method="get_fitnessage_data", table="user_metrics", per_day=True,
        note="fitness age",
    ),
)

BY_NAME = {endpoint.name: endpoint for endpoint in ENDPOINTS}
