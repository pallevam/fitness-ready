/**
 * Compact, phone-sized shapes for tool responses, and the date arithmetic the
 * engine needs. Everything here is pure.
 *
 * Payload rules: round to the precision a person would quote, omit nulls,
 * keep units in field names (model.ts conventions), carry scores with their
 * scale, and move per-record flags and provenance up into the envelope so
 * they are said once, not once per row.
 */

import type {
  Daily,
  Flag,
  HrZone,
  Lap,
  LocalDate,
  LocalDateTime,
  Night,
  Sample,
  Score,
  Session,
} from "../model.ts";

// ------------------------------------------------------------------- dates

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = Date.parse(`${d}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Inclusive day count of start..end. */
export function daysInclusive(start: LocalDate, end: LocalDate): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The local date of a local date-time ("2026-11-05T02:59:00+05:30" -> "2026-11-05"). */
export function dateOf(t: LocalDateTime): LocalDate {
  return t.slice(0, 10);
}

// --------------------------------------------------------------- rounding

export function r0(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : Math.round(x);
}

export function r1(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
}

export function r2(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
}

/**
 * Drop null/undefined values recursively. Empty arrays are kept: an empty
 * `flags` list is information ("nothing to distrust").
 */
export function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => compact(x)) as T;
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === null || x === undefined) continue;
      out[k] = compact(x);
    }
    return out as T;
  }
  return v;
}

/** "72 (0-100, GOOD)": the scale travels with the number, so 1-4 is never read as /100. */
export function scoreText(s: Score | null): string | null {
  if (!s) return null;
  const v = Number.isInteger(s.value) ? s.value : r1(s.value);
  return `${v} (${s.min}-${s.max}${s.label ? `, ${s.label}` : ""})`;
}

// ------------------------------------------------------------------- flags

/** A flag plus which record it is about, once it has been lifted into an envelope. */
export type TaggedFlag = Flag & { on?: string };

export function tag(flags: Flag[], on: string): TaggedFlag[] {
  return flags.map((f) => ({ ...f, on }));
}

export const nightRef = (n: Night): string => `night ${n.wake_date}`;
export const sessionRef = (s: Session): string => `session ${s.id}`;
export const dayRef = (d: Daily): string => `day ${d.date}`;

// ----------------------------------------------------------------- records

/** One line per night, for trends: the numbers a person compares across nights. */
export function nightRow(n: Night) {
  return {
    wake_date: n.wake_date,
    asleep_min: r0(n.asleep_min),
    score: scoreText(n.score),
    hrv_avg_ms: r0(n.hrv_avg_ms),
    resting_hr_bpm: r0(n.resting_hr_bpm),
    validation: n.validation,
  };
}

/** Everything about one night except provenance and flags (those go to the envelope). */
export function nightFull(n: Night) {
  return {
    wake_date: n.wake_date,
    label: n.label,
    start: n.start,
    end: n.end,
    asleep_min: r0(n.asleep_min),
    deep_min: r0(n.deep_min),
    light_min: r0(n.light_min),
    rem_min: r0(n.rem_min),
    awake_min: r0(n.awake_min),
    score: scoreText(n.score),
    hrv_avg_ms: r0(n.hrv_avg_ms),
    hrv_baseline_ms:
      n.hrv_baseline_low_ms != null && n.hrv_baseline_high_ms != null
        ? `${r0(n.hrv_baseline_low_ms)}-${r0(n.hrv_baseline_high_ms)}`
        : null,
    resting_hr_bpm: r0(n.resting_hr_bpm),
    respiration_brpm: r1(n.respiration_brpm),
    validation: n.validation,
  };
}

/** A session in a list: enough to compare and count; get_session_detail has the rest. */
export function sessionRow(s: Session, hard: boolean) {
  const te = s.training_effect;
  return {
    id: s.id,
    // How many vendor records were joined into this one session.
    parts: s.parts.length > 1 ? s.parts.length : null,
    type: s.type,
    start: s.start,
    duration_min: r0(s.duration_min),
    distance_km: r2(s.distance_km),
    avg_hr_bpm: r0(s.avg_hr_bpm),
    max_hr_bpm: r0(s.max_hr_bpm),
    hard_min: r0(s.hard_min),
    training_effect: te ? { aerobic: r1(te.aerobic), anaerobic: r1(te.anaerobic), label: te.label } : null,
    recovery: s.recovery ? { hours: r1(s.recovery.hours), basis: s.recovery.basis } : null,
    hard,
  };
}

/** A session in the brief: the week at a glance; get_sessions and get_session_detail have more. */
export function sessionBrief(s: Session, hard: boolean) {
  const te = s.training_effect;
  return {
    id: s.id,
    parts: s.parts.length > 1 ? s.parts.length : null,
    type: s.type,
    start: s.start,
    duration_min: r0(s.duration_min),
    distance_km: r1(s.distance_km),
    avg_hr_bpm: r0(s.avg_hr_bpm),
    te_aerobic: te ? r1(te.aerobic) : null,
    recovery_h: s.recovery ? r0(s.recovery.hours) : null,
    hard,
  };
}

/** Everything about one session except provenance and flags (those go to the envelope). */
export function sessionFull(s: Session, hard: boolean) {
  const te = s.training_effect;
  return {
    id: s.id,
    parts: s.parts.length > 1 ? s.parts : null,
    type: s.type,
    vendor_type: s.vendor_type,
    start: s.start,
    end: s.end,
    tz: s.tz,
    duration_min: r1(s.duration_min),
    elapsed_min: r1(s.elapsed_min),
    distance_km: r2(s.distance_km),
    avg_hr_bpm: r0(s.avg_hr_bpm),
    max_hr_bpm: r0(s.max_hr_bpm),
    hard_min: r0(s.hard_min),
    calories_kcal: r0(s.calories_kcal),
    elevation_gain_m: r0(s.elevation_gain_m),
    avg_cadence_spm: r0(s.avg_cadence_spm),
    training_effect: te
      ? { aerobic: r1(te.aerobic), anaerobic: r1(te.anaerobic), label: te.label, source: te.source }
      : null,
    recovery: s.recovery ? { hours: r1(s.recovery.hours), basis: s.recovery.basis } : null,
    energy_impact: r0(s.energy_impact),
    hard,
  };
}

export function lapRow(l: Lap) {
  return {
    index: l.index,
    distance_km: r2(l.distance_km),
    duration_min: r1(l.duration_min),
    moving_min: Math.abs(l.moving_min - l.duration_min) >= 0.1 ? r1(l.moving_min) : null,
    avg_hr_bpm: r0(l.avg_hr_bpm),
    max_hr_bpm: r0(l.max_hr_bpm),
    avg_cadence_spm: r0(l.avg_cadence_spm),
    stride_cm: r0(l.stride_cm),
    elevation_gain_m: r0(l.elevation_gain_m),
    elevation_loss_m: r0(l.elevation_loss_m),
  };
}

export function zoneRow(z: HrZone) {
  return { zone: z.zone, low_bpm: r0(z.low_bpm), minutes: r1(z.minutes) };
}

// ----------------------------------------------------------------- samples

export const MAX_SAMPLE_POINTS = 300;

const SAMPLE_COLUMNS = ["elapsed_s", "hr_bpm", "speed_mps", "cadence_spm", "elevation_m", "distance_m"] as const;
type SampleColumn = (typeof SAMPLE_COLUMNS)[number];
const ROUND: Record<SampleColumn, (x: number | null) => number | null> = {
  elapsed_s: r0,
  hr_bpm: r0,
  speed_mps: r2,
  cadence_spm: r0,
  elevation_m: r1,
  distance_m: r0,
};

export interface SampleTable {
  /** Points returned. */
  points: number;
  /** Points recorded. */
  of: number;
  /** Every k-th recorded point was kept. */
  every: number;
  columns: SampleColumn[];
  rows: (number | null)[][];
}

/**
 * Columnar, downsampled to at most `max` points by keeping every k-th point.
 * Columns that are null throughout are dropped. Columnar keeps 300 points
 * near 10 KB instead of ~40 KB as objects.
 */
export function sampleTable(samples: Sample[], max = MAX_SAMPLE_POINTS): SampleTable {
  const every = Math.max(1, Math.ceil(samples.length / max));
  const kept = samples.filter((_, i) => i % every === 0);
  const columns = SAMPLE_COLUMNS.filter((c) => samples.some((s) => s[c] != null));
  return {
    points: kept.length,
    of: samples.length,
    every,
    columns,
    rows: kept.map((s) => columns.map((c) => ROUND[c](s[c]))),
  };
}
