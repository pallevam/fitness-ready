/** Synthetic canonical records for meaning-layer tests. No personal data. */

import type { Daily, Night, Sample, Session } from "../../src/model.ts";
import { nightLabel } from "../../src/meaning/index.ts";
import { addDays } from "../../src/meaning/time.ts";

export const TZ = "Asia/Kolkata";
export const OFF = "+05:30";

/** "2026-11-02T13:35:00+05:30" */
export function at(date: string, hhmm: string): string {
  return `${date}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}${OFF}`;
}

function shift(t: string, minutes: number): string {
  // Local wall-clock arithmetic in the fixed test offset.
  const ms = Date.parse(t) + minutes * 60_000 + 5.5 * 3_600_000;
  return `${new Date(ms).toISOString().slice(0, 19)}${OFF}`;
}

export function session(over: Partial<Session> & { id: string; start: string; duration_min: number }): Session {
  const end = over.end ?? shift(over.start, over.duration_min);
  return {
    parts: [over.id],
    type: "running",
    vendor_type: "running",
    tz: TZ,
    elapsed_min: over.duration_min,
    distance_km: null,
    avg_hr_bpm: null,
    max_hr_bpm: null,
    hard_min: null,
    calories_kcal: null,
    elevation_gain_m: null,
    avg_cadence_spm: null,
    training_effect: null,
    recovery: null,
    energy_impact: null,
    flags: [],
    provenance: { vendor: "garmin", source: "garmin:activities", record_ids: [over.id], steps: [] },
    ...over,
    end,
  };
}

export function night(wakeDate: string, over: Partial<Night> = {}): Night {
  return {
    wake_date: wakeDate,
    label: nightLabel(wakeDate),
    start: at(addDays(wakeDate, -1), "23:00"),
    end: at(wakeDate, "06:30"),
    tz: TZ,
    asleep_min: 420,
    deep_min: 80,
    light_min: 240,
    rem_min: 100,
    awake_min: 30,
    score: { value: 80, min: 0, max: 100 },
    hrv_avg_ms: 60,
    hrv_baseline_low_ms: 55,
    hrv_baseline_high_ms: 70,
    resting_hr_bpm: 55,
    respiration_brpm: 14,
    validation: "device",
    flags: [],
    provenance: { vendor: "garmin", source: "garmin:sleep", record_ids: [wakeDate], steps: [] },
    ...over,
  };
}

export function daily(date: string, restingHr: number | null): Daily {
  return {
    date,
    resting_hr_bpm: restingHr,
    steps: 8000,
    stress_avg: null,
    energy_high: null,
    energy_low: null,
    intensity_min: null,
    flags: [],
    provenance: { vendor: "garmin", source: "garmin:daily", record_ids: [date], steps: [] },
  };
}

/** `days` dailies ending the day before `asOf` at `rhr`, plus `today` on asOf. */
export function dailies(asOf: string, rhr: number, today: number | null, days = 30): Daily[] {
  const out: Daily[] = [];
  for (let i = days; i >= 1; i--) out.push(daily(addDays(asOf, -i), rhr));
  out.push(daily(asOf, today));
  return out;
}

/** One sample per second from a list of HR values, starting at `t0` local. */
export function hrSeries(hrs: number[], t0 = at("2026-11-01", "18:00"), stepS = 1): Sample[] {
  return hrs.map((hr, i) => ({
    t: shift(t0, (i * stepS) / 60),
    elapsed_s: i * stepS,
    hr_bpm: hr,
    speed_mps: null,
    cadence_spm: null,
    elevation_m: null,
    distance_m: null,
  }));
}

/** Deterministic jitter in [-amp, amp], so tests never depend on Math.random. */
export function jitter(i: number, amp: number): number {
  return Math.round(Math.sin(i * 12.9898) * 43758.5453 % 1 * amp);
}
