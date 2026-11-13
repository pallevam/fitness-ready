/**
 * Garmin time handling. Garmin sends every local time twice: as local wall
 * clock and as GMT. Their difference is the user's UTC offset at that moment,
 * which is the only reliable timezone signal in the data (activities carry an
 * internal `timeZoneId`, not an IANA name).
 */

import type { LocalDate, LocalDateTime } from "../../model.ts";

const MINUTE_MS = 60_000;

/** Parse Garmin's zone-less timestamps ("2026-11-05 17:54:28", "...T02:14:06.0") as UTC wall clock. */
export function wallClockMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length < 10) return null;
  const text = value.trim().replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Offset in minutes from a local and a GMT reading of the same instant, rounded to 15 min. */
export function offsetMinutes(local: unknown, gmt: unknown): number | null {
  const l = wallClockMs(local);
  const g = wallClockMs(gmt);
  if (l === null || g === null) return null;
  const minutes = Math.round((l - g) / MINUTE_MS / 15) * 15;
  return Math.abs(minutes) <= 14 * 60 ? minutes : null;
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** UTC instant (ms) + offset -> "2026-11-05T02:59:00+05:30". */
export function toLocalIso(utcMs: number, offsetMin: number): LocalDateTime {
  const wall = new Date(utcMs + offsetMin * MINUTE_MS).toISOString().slice(0, 19);
  return `${wall}${formatOffset(offsetMin)}`;
}

/** Local wall clock (ms, as if UTC) + offset -> local ISO with offset. */
export function wallToLocalIso(wallMs: number, offsetMin: number): LocalDateTime {
  return toLocalIso(wallMs - offsetMin * MINUTE_MS, offsetMin);
}

/** The offset an IANA zone has at an instant, in minutes; null if the zone is unknown. */
export function zoneOffsetAt(zone: string, utcMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date(utcMs));
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name === "GMT") return 0;
    const m = /GMT([+-])(\d\d):(\d\d)/.exec(name);
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === "-" ? -minutes : minutes;
  } catch {
    return null;
  }
}

/**
 * The `tz` to report: the configured zone name when its offset at that moment
 * matches what Garmin's timestamps say, otherwise the bare offset ("+05:30"),
 * so travel never gets labelled with the home zone.
 */
export function tzName(configured: string | undefined, utcMs: number, offsetMin: number): string {
  if (configured && zoneOffsetAt(configured, utcMs) === offsetMin) return configured;
  return formatOffset(offsetMin);
}

/** Inclusive list of YYYY-MM-DD dates. */
export function datesIn(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
