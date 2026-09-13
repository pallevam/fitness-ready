"""Contract tests for the five tool endpoints (SPEC §7)."""

from __future__ import annotations

from datetime import date

import pytest

AS_OF = "2026-09-13"


def test_health_reports_row_counts(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["rows"]["daily"] == 180
    assert body["latest_date"] == AS_OF


def test_daily_metrics_returns_the_requested_range(client):
    body = client.get(
        "/tools/get_daily_metrics", params={"start_date": "2026-09-07", "end_date": AS_OF}
    ).json()
    assert [row["date"] for row in body["rows"]][0] == "2026-09-07"
    assert len(body["rows"]) == 7
    assert body["data_gaps"] == []


def test_sleep_exposes_validation_and_flags_untrustworthy_nights(client):
    body = client.get(
        "/tools/get_sleep", params={"start_date": "2026-09-07", "end_date": AS_OF}
    ).json()
    by_date = {row["date"]: row for row in body["rows"]}
    assert by_date["2026-09-08"]["validation"] == "OFF_WRIST"
    assert by_date["2026-09-08"]["trustworthy"] is False
    assert by_date["2026-09-10"]["validation"] == "MANUAL"
    assert by_date[AS_OF]["trustworthy"] is True
    assert any("not trustworthy" in gap for gap in body["data_gaps"])


def test_hrv_trend_reports_both_means_and_the_gap(client):
    body = client.get("/tools/get_hrv_trend", params={"days": 30, "as_of": AS_OF}).json()
    assert body["baseline_low"] == 43 and body["baseline_high"] == 52
    assert body["mean_7d"] is not None and body["mean_60d"] is not None
    assert body["latest_vs_baseline"] == "below"
    assert "no HRV on 2026-09-11" in body["data_gaps"]


def test_activities_filter_by_type_and_flag_hard_sessions(client):
    body = client.get(
        "/tools/list_activities",
        params={"start_date": "2026-09-01", "end_date": AS_OF, "type": "running"},
    ).json()
    assert body["count"] == len(body["rows"]) > 0
    assert {row["type"] for row in body["rows"]} == {"running"}
    assert body["hard_session_count"] == sum(1 for row in body["rows"] if row["hard_session"])


def test_activities_empty_range_reports_a_gap_not_an_error(client):
    body = client.get(
        "/tools/list_activities",
        params={"start_date": "2019-01-01", "end_date": "2019-01-05"},
    ).json()
    assert body["rows"] == []
    assert body["data_gaps"] and "no activities" in body["data_gaps"][0]


def test_readiness_bundle_shape(client):
    body = client.get("/tools/get_readiness_inputs", params={"date": AS_OF}).json()
    assert set(body) >= {
        "date", "sleep", "hrv", "resting_hr", "last_hard_session", "body_battery", "data_gaps"
    }
    assert body["sleep"]["trustworthy"] is True
    assert body["hrv"]["vs_baseline"] == "below"
    resting = body["resting_hr"]
    assert resting["delta"] == pytest.approx(resting["today"] - resting["mean_30d"], abs=0.05)
    # The fixture's pinned week deliberately sits above baseline (SPEC §8 amber/red).
    assert resting["delta"] > 3
    hard = body["last_hard_session"]
    assert hard["type"] == "running"
    assert hard["recovery_remaining_hours"] == max(
        0, round(hard["recovery_time_hours"] - hard["hours_ago"])
    )


def test_readiness_on_a_day_with_no_hrv_says_so(client):
    body = client.get("/tools/get_readiness_inputs", params={"date": "2026-09-11"}).json()
    assert body["hrv"]["last_night_avg"] is None
    assert "no HRV on 2026-09-11" in body["data_gaps"]
    # The baseline band still comes from the most recent night that had one.
    assert body["hrv"]["baseline_low"] == 43


def test_readiness_defaults_to_the_latest_loaded_day(client):
    assert client.get("/tools/get_readiness_inputs").json()["date"] == AS_OF


@pytest.mark.parametrize(
    "params, status",
    [
        ({"start_date": "2026-09-13", "end_date": "2026-09-01"}, 422),  # reversed
        ({"start_date": "2020-01-01", "end_date": "2026-09-13"}, 422),  # > 365 days
        ({"start_date": "not-a-date", "end_date": "2026-09-13"}, 422),
        ({"start_date": "2026-09-01"}, 422),                            # missing param
    ],
)
def test_range_validation(client, params, status):
    assert client.get("/tools/get_daily_metrics", params=params).status_code == status


def test_exactly_365_days_is_allowed(client):
    end = date(2026, 9, 13)
    start = date(2025, 9, 14)
    assert (end - start).days + 1 == 365
    response = client.get(
        "/tools/get_daily_metrics",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )
    assert response.status_code == 200
