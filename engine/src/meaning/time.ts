/**
 * Date and time helpers for the meaning layer. Local date-times carry their
 * offset, so instants compare correctly across zones; for display we read the
 * local wall-clock text back out of the string rather than re-deriving it.
 */

import type { LocalDate, LocalDateTime } from "../model.ts";

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

export function instant(t: LocalDateTime): number {
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Error(`not an ISO-8601 date-time: ${t}`);
  return ms;
}

export function minutesBetween(earlier: LocalDateTime | number, later: LocalDateTime | number): number {
  const a = typeof earlier === "number" ? earlier : instant(earlier);
  const b = typeof later === "number" ? later : instant(later);
  return (b - a) / MS_PER_MIN;
}

export function hoursBetween(earlier: LocalDateTime | number, later: LocalDateTime | number): number {
  const a = typeof earlier === "number" ? earlier : instant(earlier);
  const b = typeof later === "number" ? later : instant(later);
  return round((b - a) / MS_PER_HOUR, 1);
}

export function addMinutes(t: LocalDateTime, minutes: number): number {
  return instant(t) + minutes * MS_PER_MIN;
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(date: LocalDate, n: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The offset suffix of a local date-time ("+05:30", "Z"), or "" if none. */
export function offsetOf(t: LocalDateTime): string {
  const m = /([+-]\d\d:?\d\d|Z)$/.exec(t);
  return m?.[1] ?? "";
}

/** "13:35" from "2026-11-01T13:35:00+05:30": the user's wall clock. */
export function clock(t: LocalDateTime): string {
  return t.slice(11, 16);
}

/** "2026-11-01 13:35" from a local date-time. */
export function dayClock(t: LocalDateTime): string {
  return `${t.slice(0, 10)} ${clock(t)}`;
}

export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Signed number the way a reader expects: "+2.8", "+0", "-1.5". */
export function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${Object.is(value, -0) ? 0 : value}`;
}
