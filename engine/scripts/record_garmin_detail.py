"""Record per-activity detail so the engine's dev snapshots include it.

    python engine/scripts/record_garmin_detail.py --limit 10

Run from the repo root (it imports `fetcher.client`). For the most recent
running / strength activities listed under raw/api/api-responses/activities/,
it saves, read-only and paced by the existing client:

    activity_details/<id>.json   get_activity_details(maxchart=10000, maxpoly=0)
    activity_splits/<id>.json    get_activity_splits
    hr_zones/<id>.json           get_activity_hr_in_timezones
    fit/<id>.fit                 the ORIGINAL device file, unzipped

GPS is stripped before anything touches disk: lat/lon/polyline/location keys
are dropped from JSON, GPS metric columns in the detail chart are nulled, and
every semicircle position field in the FIT file is overwritten with the FIT
"invalid" value (CRC recomputed), so the file still decodes but carries no
location. Already-recorded activities are skipped unless --force.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import re
import struct
import sys
import zipfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

DEFAULT_ROOT = REPO / "raw" / "api" / "api-responses"
WANTED_TYPES = {"running", "treadmill_running", "trail_running", "track_running", "strength_training"}

log = logging.getLogger("record_garmin_detail")

# ------------------------------------------------------------------ JSON scrub

_GPS_KEY = re.compile(r"(?i)(latitude|longitude|polyline|location|geopoint)")
_GPS_SUFFIX = re.compile(r"(^|[a-z0-9_])(Lat|Lon|Lng|Long)$")
_GPS_METRIC = re.compile(r"(?i)(latitude|longitude)")


def _is_gps_key(key: str) -> bool:
    return bool(_GPS_KEY.search(key) or _GPS_SUFFIX.search(key)) or key.lower() in {"lat", "lon", "lng", "long"}


def strip_gps(value: Any) -> Any:
    """Drop every GPS-bearing key, recursively."""
    if isinstance(value, dict):
        return {k: strip_gps(v) for k, v in value.items() if not _is_gps_key(k)}
    if isinstance(value, list):
        return [strip_gps(v) for v in value]
    return value


def null_gps_metrics(details: Any) -> Any:
    """In get_activity_details, null the chart columns whose descriptor is a coordinate.

    The descriptors are kept (so column indices still line up); only the values go.
    """
    if not isinstance(details, dict):
        return details
    descriptors = details.get("metricDescriptors") or []
    gps_columns = {
        d.get("metricsIndex") for d in descriptors
        if isinstance(d, dict) and _GPS_METRIC.search(str(d.get("key", "")))
    }
    for row in details.get("activityDetailMetrics") or []:
        metrics = row.get("metrics") if isinstance(row, dict) else None
        if isinstance(metrics, list):
            for index in gps_columns:
                if isinstance(index, int) and 0 <= index < len(metrics):
                    metrics[index] = None
    return details


# ------------------------------------------------------------------- FIT scrub

# (global message number -> field numbers in semicircles), generated from the
# @garmin/fitsdk 21.221 profile: every field whose units are "semicircles".
FIT_GPS_FIELDS: dict[int, set[int]] = {
    18: {3, 4, 29, 30, 31, 32, 38, 39},   # session
    19: {3, 4, 5, 6, 27, 28, 29, 30},     # lap
    20: {0, 1},                           # record
    32: {2, 3},                           # course_point
    128: {10, 11},                        # weather_conditions
    142: {3, 4, 5, 6, 25, 26, 27, 28},    # segment_lap
    150: {1, 2},                          # segment_point
    160: {1, 2},                          # gps_metadata
    285: {5, 6},                          # jump
    312: {17, 18, 19, 20, 21, 22, 23, 24},  # split
    317: {0, 1},                          # climb_pro
}
SINT32_INVALID_LE = b"\xff\xff\xff\x7f"
SINT32_INVALID_BE = b"\x7f\xff\xff\xff"

_CRC_TABLE = (
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
)


def fit_crc(data: bytes, crc: int = 0) -> int:
    for byte in data:
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[byte & 0xF]
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[(byte >> 4) & 0xF]
    return crc


def scrub_fit(data: bytes) -> tuple[bytes, int]:
    """Overwrite every semicircle position with FIT's invalid value.

    Walks the FIT record stream (definition, data and compressed-timestamp
    messages, developer fields) and patches in place. Returns (bytes, fields
    blanked). Raises ValueError on a file it cannot walk, so nothing half-
    scrubbed is written.
    """
    buf = bytearray(data)
    header_size = buf[0]
    data_size = struct.unpack_from("<I", buf, 4)[0]
    if buf[8:12] != b".FIT":
        raise ValueError("not a FIT file")
    pos, end = header_size, header_size + data_size
    if end + 2 > len(buf):
        raise ValueError("truncated FIT file")
    # local message type -> (global number, little endian, [(field num, offset, size)], record size)
    local: dict[int, tuple[int, bool, list[tuple[int, int, int]], int]] = {}
    blanked = 0
    while pos < end:
        header = buf[pos]
        pos += 1
        if header & 0x80:  # compressed timestamp header: a data message
            local_num = (header >> 5) & 0x3
            is_definition = False
        else:
            local_num = header & 0x0F
            is_definition = bool(header & 0x40)
        if is_definition:
            has_dev = bool(header & 0x20)
            little = buf[pos + 1] == 0
            global_num = struct.unpack_from("<H" if little else ">H", buf, pos + 2)[0]
            n_fields = buf[pos + 4]
            pos += 5
            fields: list[tuple[int, int, int]] = []
            offset = 0
            for _ in range(n_fields):
                num, size = buf[pos], buf[pos + 1]
                fields.append((num, offset, size))
                offset += size
                pos += 3
            if has_dev:
                n_dev = buf[pos]
                pos += 1
                for _ in range(n_dev):
                    offset += buf[pos + 1]
                    pos += 3
            local[local_num] = (global_num, little, fields, offset)
            continue
        if local_num not in local:
            raise ValueError(f"data message for undefined local type {local_num} at {pos - 1}")
        global_num, little, fields, size = local[local_num]
        wanted = FIT_GPS_FIELDS.get(global_num)
        if wanted:
            for num, offset, fsize in fields:
                if num in wanted and fsize == 4:
                    buf[pos + offset:pos + offset + 4] = SINT32_INVALID_LE if little else SINT32_INVALID_BE
                    blanked += 1
        pos += size
    if pos != end:
        raise ValueError("FIT record stream did not end on the declared size")
    struct.pack_into("<H", buf, end, fit_crc(bytes(buf[:end])))
    return bytes(buf), blanked


def unzip_fit(payload: bytes) -> bytes:
    if payload[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".fit")]
            if not names:
                raise ValueError("ORIGINAL download has no .fit inside")
            return archive.read(names[0])
    return payload


# ------------------------------------------------------------------- selection

def recent_activities(root: Path, limit: int) -> list[tuple[str, str, str]]:
    """(start local, id, type) for the newest running/strength activities on disk."""
    found: dict[str, tuple[str, str, str]] = {}
    for path in sorted((root / "activities").glob("*.json")):
        try:
            items = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for item in items if isinstance(items, list) else []:
            kind = (item.get("activityType") or {}).get("typeKey")
            if item.get("activityId") is None or kind not in WANTED_TYPES:
                continue
            ident = str(item["activityId"])
            found[ident] = (str(item.get("startTimeLocal", "")), ident, kind)
    return sorted(found.values(), reverse=True)[:limit]


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, default=str))


def record(session: Any, root: Path, ident: str, force: bool) -> list[str]:
    done: list[str] = []
    targets = {
        "activity_details": lambda: null_gps_metrics(
            session.call("get_activity_details", ident, maxchart=10000, maxpoly=0)),
        "activity_splits": lambda: session.call("get_activity_splits", ident),
        "hr_zones": lambda: session.call("get_activity_hr_in_timezones", ident),
    }
    for kind, fetch in targets.items():
        path = root / kind / f"{ident}.json"
        if path.exists() and not force:
            continue
        payload = fetch()
        if payload is None:
            continue
        _write_json(path, strip_gps(payload))
        done.append(kind)

    fit_path = root / "fit" / f"{ident}.fit"
    if force or not fit_path.exists():
        from garminconnect import Garmin

        raw = session.call("download_activity", ident, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
        if raw:
            scrubbed, blanked = scrub_fit(unzip_fit(bytes(raw)))
            fit_path.parent.mkdir(parents=True, exist_ok=True)
            fit_path.write_bytes(scrubbed)
            done.append(f"fit({blanked} positions blanked)")
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--scrub-only", action="store_true",
                        help="re-scrub the files already on disk; no Garmin calls")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.scrub_only:
        for path in sorted((args.root / "fit").glob("*.fit")):
            scrubbed, blanked = scrub_fit(path.read_bytes())
            path.write_bytes(scrubbed)
            log.info("%s: %d positions blanked", path.name, blanked)
        return 0

    from fetcher.client import connect

    picks = recent_activities(args.root, args.limit)
    if not picks:
        log.error("no running/strength activities under %s/activities", args.root)
        return 1
    session = connect(allow_prompt=False)
    for start, ident, kind in picks:
        done = record(session, args.root, ident, args.force)
        log.info("%s %s %s: %s", start[:10], kind, ident, ", ".join(done) or "already recorded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
