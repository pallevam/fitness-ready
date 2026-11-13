/**
 * The real clock, for the entry points only. The Engine never reads time
 * itself; it is handed `now`, so tests pin it.
 */

import type { LocalDateTime } from "../model.ts";

/** Current local time in `tz` as ISO-8601 with offset, e.g. 2026-11-13T07:40:00+05:30. */
export function localNow(tz: string, at: Date = new Date()): LocalDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  // "GMT+05:30", or "GMT" for UTC itself.
  const off = String(parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

/** Throws on a zone name Intl doesn't know, so a typo fails at startup, not mid-answer. */
export function checkTz(tz: string): string {
  new Intl.DateTimeFormat("en", { timeZone: tz });
  return tz;
}

export function systemTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
