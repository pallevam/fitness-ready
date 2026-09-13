"""Loader behaviour: field mapping, units, idempotency (SPEC §6.1-6.2)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from db import connect
from loader.discovery import classify, flatten, iter_records
from loader.fieldmap import as_timestamp, as_validation
from loader.load_garmin import TABLE_COLUMNS, load, rows_from_record


def test_files_classify_to_the_expected_tables(export_root: Path):
    found = {
        classify(path, export_root)
        for path in export_root.rglob("*.json")
    }
    assert found == {"daily", "sleep", "hrv", "activities", "user_metrics"}


def test_activity_envelope_is_unwrapped(export_root: Path):
    path = next(export_root.rglob("*summarizedActivities.json"))
    records = list(iter_records(path))
    assert records and "activityId" in records[0]


def test_units_are_converted(export_root: Path):
    path = next(export_root.rglob("*summarizedActivities.json"))
    raw = next(r for r in iter_records(path) if r["activityType"] == "running")
    (row,), _ = rows_from_record("activities", raw)
    assert row["duration_min"] == pytest.approx(raw["duration"] / 60_000, abs=0.01)
    assert row["distance_km"] == pytest.approx(raw["distance"] / 100_000, abs=0.01)
    assert row["avg_speed_kmh"] == pytest.approx(raw["avgSpeed"] * 0.036, abs=0.02)


def test_intensity_minutes_counts_vigorous_double(export_root: Path):
    path = next(export_root.rglob("UDSFile*.json"))
    raw = next(iter_records(path))
    (row,), _ = rows_from_record("daily", raw)
    assert row["intensity_minutes"] == (
        raw["moderateIntensityMinutes"] + 2 * raw["vigorousIntensityMinutes"]
    )


def test_wide_metrics_record_becomes_long_rows(export_root: Path):
    path = next(export_root.rglob("MetricsMaxMet*.json"))
    raw = next(iter_records(path))
    rows, _ = rows_from_record("user_metrics", raw)
    assert {row["metric"] for row in rows} == {"vo2max", "fitness_age"}


def test_unmapped_fields_are_reported_not_dropped(export_root: Path):
    path = next(export_root.rglob("*sleepData.json"))
    _, unmapped = rows_from_record("sleep", next(iter_records(path)))
    assert "sleepScores.overall.qualifierKey" in unmapped


def test_nested_keys_flatten_to_dotted_paths():
    assert flatten({"sleepScores": {"overall": {"value": 74}}}) == {"sleepScores.overall.value": 74}


def test_timestamp_parsing_accepts_every_garmin_shape():
    expected = datetime(2026, 9, 13, 6, 18, 0)
    assert as_timestamp("2026-09-13 06:18:00") == expected
    assert as_timestamp("2026-09-13T06:18:00.0") == expected
    assert as_timestamp("2026-09-13T06:18:00.0Z") == expected
    # Epoch inputs are read as GMT (Garmin's *TimestampGMT / beginTimestamp fields);
    # the loader prefers the *Local variants wherever the export provides them.
    epoch_ms = int(expected.replace(tzinfo=timezone.utc).timestamp() * 1000)
    assert as_timestamp(epoch_ms) == expected
    assert as_timestamp(epoch_ms // 1000) == expected


def test_validation_aliases_normalise():
    assert as_validation("enhanced_confirmed_final") == "ENHANCED_FINAL"
    assert as_validation("OFFWRIST") == "OFF_WRIST"
    assert as_validation("DEVICE") == "DEVICE"


def test_row_counts_match_the_export(conn, export_root: Path):
    counted = {
        "daily": len(list(iter_records(next(export_root.rglob("UDSFile*.json"))))),
        "sleep": len(list(iter_records(next(export_root.rglob("*sleepData.json"))))),
        "hrv": len(list(iter_records(next(export_root.rglob("HRV_*.json"))))),
        "activities": len(list(iter_records(next(export_root.rglob("*summarizedActivities.json"))))),
    }
    for table, expected in counted.items():
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == expected


def test_load_is_idempotent(tmp_path: Path, export_root: Path):
    target = tmp_path / "idempotent.duckdb"
    with connect(target) as conn:
        load(export_root, conn)
        first = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLE_COLUMNS}
        load(export_root, conn)
        second = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLE_COLUMNS}
        assert first == second
        # ... and the load is still audited twice.
        assert conn.execute("SELECT count(*) FROM load_log").fetchone()[0] == 10


def test_records_without_a_primary_key_are_skipped():
    rows, _ = rows_from_record("activities", {"activityType": "running", "duration": 1000})
    assert rows == []


def test_off_wrist_nights_survive_the_load_with_zero_minutes(conn):
    row = conn.execute(
        "SELECT total_min, validation FROM sleep WHERE date = ?", [date(2026, 9, 8)]
    ).fetchone()
    assert row == (0, "OFF_WRIST")
