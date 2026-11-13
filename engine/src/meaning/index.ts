/**
 * The meaning layer: pure rules over canonical records. No I/O, no vendor data,
 * no clock reads: `now` is always passed in, so every rule is deterministic.
 *
 * These signatures are the contract the MCP tools build against. The bodies
 * are ported from tools/derived.py and tools/queries.py.
 */

import type {
  Daily,
  Flag,
  LocalDate,
  LocalDateTime,
  Night,
  Sample,
  Session,
  Step,
} from "../model.ts";

// ------------------------------------------------------------------ nights

/** "night of 2026-11-04 into 2026-11-05" for wake date 2026-11-05. */
export function nightLabel(wakeDate: LocalDate): string {
  throw new Error("not implemented");
}

/**
 * Last night is the night whose wake_date is `asOf`. If it is missing, return
 * null plus a `not_synced` flag naming the night, and never substitute an
 * earlier night (the bug of 20 Oct).
 */
export function lastNight(nights: Night[], asOf: LocalDate): { night: Night | null; flags: Flag[] } {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------- sessions

/** A run saved in parts is one session (the 15 Sep 12.37 km run). */
export const SESSION_MERGE_GAP_MIN = 10;

/**
 * Join consecutive same-type sessions whose next part starts within
 * `maxGapMin` of the previous part's end. Sums distance, duration, calories,
 * elevation, hard minutes, energy impact; duration-weights avg HR; maxes max
 * HR, training effect and recovery; adds a `merged_parts` flag and a step.
 * Input sorted by start.
 */
export function mergeSplitSessions(sessions: Session[], maxGapMin = SESSION_MERGE_GAP_MIN): Session[] {
  throw new Error("not implemented");
}

/** Hard: aerobic or anaerobic TE >= 3.0, or a TE label/hard minutes rule from SPEC §6.3. */
export function isHardSession(session: Session): boolean {
  throw new Error("not implemented");
}

/**
 * Flag physiologically implausible HR: a rise faster than ~5 bpm/s, or a
 * short isolated peak far above the surrounding level (the 181 bpm spike of
 * 1 Nov). Returns flags with the spike's time and value in the message.
 */
export function detectHrSpikes(samples: Sample[]): Flag[] {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------- recovery

/** Used when the device gives no recovery time. */
export const ASSUMED_RECOVERY_H = 24;

export interface RecoveryStatus {
  last_hard: Session | null;
  /** Hours from the end of the last hard session to `now`. */
  hours_since: number | null;
  remaining_h: number | null;
  basis: "device" | "assumed" | null;
  steps: Step[];
}

/**
 * Recovery counts from the session's end to `now` (the bug of 2 Nov), using
 * the device's recovery hours when present, else ASSUMED_RECOVERY_H.
 */
export function recoveryStatus(sessions: Session[], now: LocalDateTime): RecoveryStatus {
  throw new Error("not implemented");
}

// --------------------------------------------------------------- readiness

export interface Check {
  name: "sleep" | "hrv" | "resting_hr" | "recovery";
  result: "pass" | "fail" | "missing";
  /** e.g. "score 60 (0-100)", "59 ms, within 57-72", "+2.8 bpm vs 30-day mean". */
  value: string;
  rule: string;
}

export interface Readiness {
  as_of: LocalDate;
  colour: "green" | "amber" | "red" | "insufficient_data";
  checks: Check[];
  failed: Check["name"][];
  missing: Check["name"][];
  /** "3 of 4 checks" */
  based_on: string;
  flags: Flag[];
  how_built: Step[];
}

export interface ReadinessInput {
  as_of: LocalDate;
  now: LocalDateTime;
  /** At least the last 60 nights for the HRV means. */
  nights: Night[];
  /** At least the last 30 days for the resting-HR mean. */
  dailies: Daily[];
  /** Merged sessions from the last 7 days or more. */
  sessions: Session[];
}

/**
 * The four-check verdict from SPEC §8: sleep (trustworthy and score >= 70),
 * HRV (inside the baseline band), resting HR (<= +3 bpm vs the 30-day mean),
 * recovery (none remaining). 0 failed: green; 1: amber; 2+: red; fewer than
 * 2 checks available: insufficient_data.
 */
export function readiness(input: ReadinessInput): Readiness {
  throw new Error("not implemented");
}

// ------------------------------------------------------------------- trend

export interface Trend {
  as_of: LocalDate;
  hrv_last_ms: number | null;
  hrv_7d_mean_ms: number | null;
  hrv_60d_mean_ms: number | null;
  hrv_baseline_low_ms: number | null;
  hrv_baseline_high_ms: number | null;
  resting_hr_last_bpm: number | null;
  resting_hr_30d_mean_bpm: number | null;
  /** Wake dates in the window with no night, so "3 of the last 7" is honest. */
  missing_nights: LocalDate[];
  steps: Step[];
}

export function trend(nights: Night[], dailies: Daily[], asOf: LocalDate): Trend {
  throw new Error("not implemented");
}
