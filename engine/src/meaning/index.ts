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
  TrainingEffect,
} from "../model.ts";
import { detectHrSpikesImpl } from "./hr.ts";
import {
  addDays,
  addMinutes,
  clock,
  dateRange,
  dayClock,
  hoursBetween,
  instant,
  minutesBetween,
  offsetOf,
  round,
  signed,
} from "./time.ts";

export {
  HR_PEAK_EXCESS_BPM,
  HR_PEAK_MAX_DURATION_S,
  HR_PEAK_WINDOW_S,
  HR_SPIKE_MAX_RISE_BPM_PER_S,
  HR_SPIKE_MIN_FAST_INTERVALS,
} from "./hr.ts";

// ----------------------------------------------------------- SPEC §6.3 rules

/** Rolling windows (SPEC §6.3). */
export const RESTING_HR_WINDOW_DAYS = 30;
export const HRV_SHORT_WINDOW_DAYS = 7;
export const HRV_LONG_WINDOW_DAYS = 60;

export const HARD_SESSION_AEROBIC_TE = 3.0;
export const HARD_SESSION_ANAEROBIC_TE = 3.0;
export const HARD_SESSION_RECOVERY_H = 24;
/** Minutes at or above HR zone 4. */
export const HARD_SESSION_ZONE4_MIN = 20;
/** Strength-only arm: the watch gives strength no TE and no recovery time. */
export const HARD_STRENGTH_MIN_DURATION_MIN = 50;
export const HARD_STRENGTH_MIN_AVG_HR_BPM = 115;

export const READINESS_SLEEP_SCORE_MIN = 70;
export const READINESS_RESTING_HR_DELTA_MAX_BPM = 3;
/** More missing checks than this gives insufficient_data. */
export const READINESS_MAX_MISSING = 1;

// ------------------------------------------------------------------ nights

/** "night of 2026-11-04 into 2026-11-05" for wake date 2026-11-05. */
export function nightLabel(wakeDate: LocalDate): string {
  return `night of ${addDays(wakeDate, -1)} into ${wakeDate}`;
}

/**
 * Last night is the night whose wake_date is `asOf`. If it is missing, return
 * null plus a `not_synced` flag naming the night, and never substitute an
 * earlier night (the bug of 20 Oct).
 */
export function lastNight(nights: Night[], asOf: LocalDate): { night: Night | null; flags: Flag[] } {
  const night = nights.find((n) => n.wake_date === asOf) ?? null;
  if (night) return { night, flags: [] };
  return {
    night: null,
    flags: [
      {
        code: "not_synced",
        severity: "warn",
        message:
          `No sleep for the ${nightLabel(asOf)} yet. If that is last night, it has not synced; ` +
          `an earlier night is not reported in its place.`,
      },
    ],
  };
}

/**
 * SPEC §6.3 "sleep is trustworthy": validation not OFF_WRIST or MANUAL, and
 * some sleep recorded. MANUAL is the canonical `user_reported` (entered by
 * hand, not measured), so it stays untrustworthy. `imputed` nights were
 * measured with some values filled in: trustworthy, but flagged.
 */
export function isSleepTrustworthy(night: Night): boolean {
  if (night.validation === "off_wrist" || night.validation === "user_reported") return false;
  return (night.asleep_min ?? 0) > 0;
}

// ---------------------------------------------------------------- sessions

/** A run saved in parts is one session (the 15 Sep 12.37 km run). */
export const SESSION_MERGE_GAP_MIN = 10;

/**
 * End by timer time (start + duration_min). A paused part ends early on this
 * clock, so the gap to the next part reads long: errs toward keeping parts apart.
 */
function timerEnd(s: Session): number {
  return addMinutes(s.start, s.duration_min);
}

function sameKind(a: Session, b: Session): boolean {
  return a.type === b.type && a.vendor_type === b.vendor_type;
}

/**
 * Join consecutive same-type sessions whose next part starts within
 * `maxGapMin` of the previous part's end. Sums distance, duration, calories,
 * elevation, hard minutes, energy impact; duration-weights avg HR; maxes max
 * HR, training effect and recovery; adds a `merged_parts` flag and a step.
 * Input sorted by start.
 */
export function mergeSplitSessions(sessions: Session[], maxGapMin = SESSION_MERGE_GAP_MIN): Session[] {
  const groups: Session[][] = [];
  for (const s of sessions) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group && last && sameKind(last, s)) {
      const gap = minutesBetween(timerEnd(last), instant(s.start));
      if (gap >= 0 && gap <= maxGapMin) {
        group.push(s);
        continue;
      }
    }
    groups.push([s]);
  }
  return groups.map(mergeGroup);
}

function present<T>(values: (T | null | undefined)[]): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined);
}

function total(values: (number | null)[]): number | null {
  const v = present(values);
  return v.length ? round(v.reduce((a, b) => a + b, 0), 2) : null;
}

function biggest(values: (number | null)[]): number | null {
  const v = present(values);
  return v.length ? Math.max(...v) : null;
}

function durationWeighted(parts: Session[], pick: (s: Session) => number | null): number | null {
  const pairs = parts
    .map((p) => [pick(p), p.duration_min] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[0] > 0);
  const weight = pairs.reduce((a, [, d]) => a + d, 0);
  return pairs.length && weight > 0 ? Math.round(pairs.reduce((a, [v, d]) => a + v * d, 0) / weight) : null;
}

function describePart(s: Session): string {
  return s.distance_km !== null ? `${s.distance_km} km` : `${round(s.duration_min, 1)} min`;
}

function mergeGroup(parts: Session[]): Session {
  const first = parts[0]!;
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1]!;
  const longest = parts.reduce((a, b) => (b.duration_min > a.duration_min ? b : a));

  const gaps = parts.slice(1).map((p, i) => minutesBetween(timerEnd(parts[i]!), instant(p.start)));
  const gapMin = round(gaps.reduce((a, b) => a + b, 0), 1);

  const tes = present(parts.map((p) => p.training_effect));
  const trainingEffect: TrainingEffect | null = tes.length
    ? {
        aerobic: biggest(tes.map((t) => t.aerobic)),
        anaerobic: biggest(tes.map((t) => t.anaerobic)),
        label: longest.training_effect?.label ?? tes.find((t) => t.label !== null)?.label ?? null,
        source: longest.training_effect?.source ?? tes[0]!.source,
      }
    : null;

  const recoveries = present(parts.map((p) => p.recovery));
  const recovery = recoveries.length ? recoveries.reduce((a, b) => (b.hours > a.hours ? b : a)) : null;

  const distance = total(parts.map((p) => p.distance_km));
  const ids = parts.flatMap((p) => p.parts.length ? p.parts : [p.id]);
  const description =
    `Saved as ${parts.length} parts (${parts.map(describePart).join(" + ")}), ` +
    `${gapMin} min apart in total; reported as one ${first.type} session` +
    (distance !== null ? ` of ${distance} km.` : ".");

  return {
    id: first.id,
    parts: ids,
    type: first.type,
    vendor_type: first.vendor_type,
    start: first.start,
    end: last.end,
    tz: first.tz,
    duration_min: total(parts.map((p) => p.duration_min)) ?? 0,
    elapsed_min: round(minutesBetween(first.start, last.end), 2),
    distance_km: distance,
    avg_hr_bpm: durationWeighted(parts, (p) => p.avg_hr_bpm),
    max_hr_bpm: biggest(parts.map((p) => p.max_hr_bpm)),
    hard_min: total(parts.map((p) => p.hard_min)),
    calories_kcal: total(parts.map((p) => p.calories_kcal)),
    elevation_gain_m: total(parts.map((p) => p.elevation_gain_m)),
    avg_cadence_spm: durationWeighted(parts, (p) => p.avg_cadence_spm),
    training_effect: trainingEffect,
    recovery,
    energy_impact: total(parts.map((p) => p.energy_impact)),
    flags: [
      ...parts.flatMap((p) => p.flags),
      { code: "merged_parts", severity: "info", message: description },
    ],
    provenance: {
      vendor: first.provenance.vendor,
      source: first.provenance.source,
      record_ids: [...new Set(parts.flatMap((p) => p.provenance.record_ids))],
      steps: [
        ...parts.flatMap((p) => p.provenance.steps),
        {
          rule: "merge_split_session",
          detail:
            `${description} Parts of the same type starting within ${SESSION_MERGE_GAP_MIN} min ` +
            `of the previous part's timer-time end are one session.`,
        },
      ],
    },
  };
}

/**
 * Why a session is hard under SPEC §6.3, one sentence per arm that fires.
 * Empty when it is not hard.
 */
export function hardSessionReasons(session: Session): string[] {
  const reasons: string[] = [];
  const te = session.training_effect;
  if (te?.aerobic != null && te.aerobic >= HARD_SESSION_AEROBIC_TE)
    reasons.push(`aerobic training effect ${te.aerobic} (0-5) >= ${HARD_SESSION_AEROBIC_TE}`);
  if (te?.anaerobic != null && te.anaerobic >= HARD_SESSION_ANAEROBIC_TE)
    reasons.push(`anaerobic training effect ${te.anaerobic} (0-5) >= ${HARD_SESSION_ANAEROBIC_TE}`);
  // Only a recovery time the device computed counts; an assumed one would be circular.
  if (session.recovery?.basis === "device" && session.recovery.hours >= HARD_SESSION_RECOVERY_H)
    reasons.push(`device recovery time ${session.recovery.hours} h >= ${HARD_SESSION_RECOVERY_H} h`);
  if ((session.hard_min ?? 0) >= HARD_SESSION_ZONE4_MIN)
    reasons.push(`${session.hard_min} min at or above HR zone 4 (>= ${HARD_SESSION_ZONE4_MIN} min)`);
  if (
    session.type === "strength" &&
    session.duration_min >= HARD_STRENGTH_MIN_DURATION_MIN &&
    (session.avg_hr_bpm ?? 0) >= HARD_STRENGTH_MIN_AVG_HR_BPM
  )
    reasons.push(
      `strength for ${round(session.duration_min, 1)} min (>= ${HARD_STRENGTH_MIN_DURATION_MIN}) ` +
        `at avg ${session.avg_hr_bpm} bpm (>= ${HARD_STRENGTH_MIN_AVG_HR_BPM})`,
    );
  return reasons;
}

/** Hard: aerobic or anaerobic TE >= 3.0, or a TE label/hard minutes rule from SPEC §6.3. */
export function isHardSession(session: Session): boolean {
  return hardSessionReasons(session).length > 0;
}

/**
 * Flag physiologically implausible HR: a rise faster than ~5 bpm/s, or a
 * short isolated peak far above the surrounding level (the 181 bpm spike of
 * 1 Nov). Returns flags with the spike's time and value in the message.
 */
export function detectHrSpikes(samples: Sample[]): Flag[] {
  return detectHrSpikesImpl(samples);
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
  const nowMs = instant(now);
  const hard = sessions
    .filter((s) => instant(s.start) <= nowMs && isHardSession(s))
    .sort((a, b) => instant(a.start) - instant(b.start));
  const last = hard[hard.length - 1];
  if (!last) {
    return {
      last_hard: null,
      hours_since: null,
      remaining_h: null,
      basis: null,
      steps: [
        {
          rule: "last_hard_session",
          detail: `No hard session started before ${dayClock(now)}, so there is nothing to recover from.`,
        },
      ],
    };
  }

  const hoursSince = Math.max(0, hoursBetween(last.end, nowMs));
  const device = last.recovery?.basis === "device" ? last.recovery : null;
  const windowH = device ? device.hours : ASSUMED_RECOVERY_H;
  const remaining = Math.max(0, round(windowH - hoursSince, 1));
  const steps: Step[] = [
    {
      rule: "last_hard_session",
      detail:
        `The last hard session is the ${last.type} session of ${dayClock(last.start)}-${clock(last.end)}, ` +
        `hard because ${hardSessionReasons(last).join("; ")}.`,
    },
    {
      rule: "recovery_from_end",
      detail:
        `Recovery counts from the session's end (${dayClock(last.end)}) to ${dayClock(now)}: ${hoursSince} h.`,
    },
    device
      ? {
          rule: "device_recovery",
          detail: `The device set a recovery time of ${device.hours} h after this session.`,
        }
      : {
          rule: "assumed_recovery",
          detail:
            `The device gave no recovery time, so ${ASSUMED_RECOVERY_H} h was assumed ` +
            `(the same ${HARD_SESSION_RECOVERY_H} h that makes a session hard).`,
        },
    {
      rule: "recovery_remaining",
      detail: `${windowH} h window minus ${hoursSince} h elapsed leaves ${remaining} h of recovery.`,
    },
  ];
  return {
    last_hard: last,
    hours_since: hoursSince,
    remaining_h: remaining,
    basis: device ? "device" : "assumed",
    steps,
  };
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
 * The instant "hours since" counts to: `now` on the current day, else the end
 * of the as-of day (midnight after it, in `now`'s offset). It used to be 18:00
 * on the as-of day, which misdated recovery by up to 7 h each morning.
 */
export function referenceInstant(asOf: LocalDate, now: LocalDateTime): LocalDateTime {
  const dayEnd = `${addDays(asOf, 1)}T00:00:00${offsetOf(now)}`;
  return instant(now) <= instant(dayEnd) ? now : dayEnd;
}

/** Mean resting HR over the 30 days before `asOf` (today excluded), and how many days fed it. */
export function restingHrBaseline(dailies: Daily[], asOf: LocalDate): { mean_bpm: number | null; days: number } {
  const from = addDays(asOf, -RESTING_HR_WINDOW_DAYS);
  const to = addDays(asOf, -1);
  const values = present(dailies.filter((d) => d.date >= from && d.date <= to).map((d) => d.resting_hr_bpm));
  return {
    mean_bpm: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 1) : null,
    days: values.length,
  };
}

function scoreOutOf100(score: { value: number; min: number; max: number }): number {
  if (score.min === 0 && score.max === 100) return score.value;
  return ((score.value - score.min) / (score.max - score.min)) * 100;
}

function hasFlag(flags: Flag[], code: Flag["code"]): boolean {
  return flags.some((f) => f.code === code);
}

/**
 * The four-check verdict from SPEC §8: sleep (trustworthy and score >= 70),
 * HRV (inside the baseline band), resting HR (<= +3 bpm vs the 30-day mean),
 * recovery (none remaining). 0 failed: green; 1: amber; 2+: red; fewer than
 * 2 checks available: insufficient_data.
 */
export function readiness(input: ReadinessInput): Readiness {
  const { as_of: asOf } = input;
  const checks: Check[] = [];
  const flags: Flag[] = [];
  const steps: Step[] = [];

  // --- sleep
  const sleepRule = `trustworthy and score >= ${READINESS_SLEEP_SCORE_MIN} (0-100)`;
  const { night, flags: nightFlags } = lastNight(input.nights, asOf);
  flags.push(...nightFlags);
  if (!night) {
    checks.push({ name: "sleep", result: "missing", value: "no sleep recorded", rule: sleepRule });
    steps.push({ rule: "last_night", detail: `No night for the ${nightLabel(asOf)}; no earlier night was used.` });
  } else {
    steps.push({ rule: "last_night", detail: `Last night is the ${night.label}, dated by the day you woke.` });
    flags.push(...night.flags);
    if (night.validation === "imputed" && !hasFlag(night.flags, "imputed")) {
      flags.push({
        code: "imputed",
        severity: "info",
        message: `Some values for the ${night.label} were filled in by the device, not measured.`,
      });
    }
    if (night.validation === "user_reported" && !hasFlag(night.flags, "user_reported")) {
      flags.push({
        code: "user_reported",
        severity: "warn",
        message: `The ${night.label} was entered by hand, not measured.`,
      });
    }
    if (!isSleepTrustworthy(night)) {
      const why =
        night.validation === "off_wrist"
          ? "off_wrist: the device was not worn"
          : night.validation === "user_reported"
            ? "user_reported: entered by hand, not measured"
            : "no sleep minutes recorded";
      checks.push({ name: "sleep", result: "fail", value: `untrustworthy (${why})`, rule: sleepRule });
      steps.push({
        rule: "sleep_trust",
        detail: `Sleep is untrustworthy (${why}), which fails the check: the night happened and was recorded badly.`,
      });
    } else if (!night.score) {
      checks.push({ name: "sleep", result: "missing", value: "no sleep score", rule: sleepRule });
      steps.push({ rule: "sleep_check", detail: "The night has no sleep score, so the sleep check is missing." });
    } else {
      const s = night.score;
      const pct = round(scoreOutOf100(s), 1);
      const pass = pct >= READINESS_SLEEP_SCORE_MIN;
      const scale = `${s.min}-${s.max}`;
      let value = `score ${s.value} (${scale})`;
      if (scale !== "0-100") value += `, ${pct} on 0-100`;
      if (night.validation === "imputed") value += ", some values imputed";
      checks.push({ name: "sleep", result: pass ? "pass" : "fail", value, rule: sleepRule });
      steps.push({
        rule: "sleep_check",
        detail: `Sleep score ${s.value} (${scale}) is ${pass ? "at or above" : "below"} ${READINESS_SLEEP_SCORE_MIN}.`,
      });
    }
  }

  // --- HRV: last night's average against that night's baseline band
  const hrvRule = "last night inside the baseline band";
  const hrv = night?.hrv_avg_ms ?? null;
  const low = night?.hrv_baseline_low_ms ?? null;
  const high = night?.hrv_baseline_high_ms ?? null;
  if (hrv === null || low === null || high === null) {
    const why = hrv === null ? "no HRV last night" : "no baseline yet";
    checks.push({ name: "hrv", result: "missing", value: why, rule: hrvRule });
    steps.push({ rule: "hrv_check", detail: `HRV check is missing: ${why}.` });
  } else {
    const position = hrv < low ? "below" : hrv > high ? "above" : "within";
    checks.push({
      name: "hrv",
      result: position === "within" ? "pass" : "fail",
      value: `${hrv} ms, ${position} baseline ${low}-${high} ms`,
      rule: hrvRule,
    });
    steps.push({
      rule: "hrv_check",
      detail: `Last night's HRV ${hrv} ms is ${position} the device's baseline band ${low}-${high} ms.`,
    });
  }

  // --- resting HR vs the trailing 30-day mean (today excluded)
  const rhrRule = `delta <= +${READINESS_RESTING_HR_DELTA_MAX_BPM} bpm vs the ${RESTING_HR_WINDOW_DAYS}-day mean`;
  const today = input.dailies.find((d) => d.date === asOf)?.resting_hr_bpm ?? null;
  const baseline = restingHrBaseline(input.dailies, asOf);
  if (baseline.days > 0 && baseline.days < RESTING_HR_WINDOW_DAYS) {
    flags.push({
      code: "partial",
      severity: "info",
      message: `Resting HR baseline built from ${baseline.days} of ${RESTING_HR_WINDOW_DAYS} days.`,
      field: "resting_hr_bpm",
    });
  }
  if (today === null || baseline.mean_bpm === null) {
    const why = today === null ? `no resting HR on ${asOf}` : "no resting HR in the previous 30 days";
    checks.push({ name: "resting_hr", result: "missing", value: why, rule: rhrRule });
    steps.push({ rule: "resting_hr_check", detail: `Resting HR check is missing: ${why}.` });
  } else {
    const delta = round(today - baseline.mean_bpm, 1);
    const pass = delta <= READINESS_RESTING_HR_DELTA_MAX_BPM;
    checks.push({
      name: "resting_hr",
      result: pass ? "pass" : "fail",
      value: `${signed(delta)} bpm vs ${RESTING_HR_WINDOW_DAYS}-day mean ${baseline.mean_bpm} bpm (today ${today} bpm)`,
      rule: rhrRule,
    });
    steps.push({
      rule: "resting_hr_check",
      detail:
        `Resting HR ${today} bpm minus the mean of the ${baseline.days} days before (${baseline.mean_bpm} bpm) ` +
        `is ${signed(delta)} bpm.`,
    });
  }

  // --- recovery
  const recoveryRule = "no recovery time remaining from the last hard session";
  const reference = referenceInstant(asOf, input.now);
  steps.push({
    rule: "reference_time",
    detail:
      reference === input.now
        ? `Hours are counted to now, ${dayClock(reference)}.`
        : `${asOf} is a past day, so hours are counted to its end.`,
  });
  const recovery = recoveryStatus(input.sessions, reference);
  steps.push(...recovery.steps);
  if (!recovery.last_hard) {
    checks.push({ name: "recovery", result: "pass", value: "no hard session on record", rule: recoveryRule });
  } else {
    let value = `${recovery.remaining_h} h remaining`;
    if (recovery.basis === "assumed") {
      value +=
        ` (assumed ${ASSUMED_RECOVERY_H} h after a hard session that ended ${recovery.hours_since} h ago; ` +
        `the device gave no recovery time)`;
      flags.push({
        code: "assumed",
        severity: "info",
        message: `Recovery assumes ${ASSUMED_RECOVERY_H} h after a hard session; the device gave no recovery time.`,
        field: "recovery",
      });
    } else {
      value += ` (device recovery ${recovery.last_hard.recovery?.hours} h, session ended ${recovery.hours_since} h ago)`;
    }
    checks.push({ name: "recovery", result: recovery.remaining_h === 0 ? "pass" : "fail", value, rule: recoveryRule });
  }

  // --- verdict
  const failed = checks.filter((c) => c.result === "fail").map((c) => c.name);
  const missing = checks.filter((c) => c.result === "missing").map((c) => c.name);
  const colour: Readiness["colour"] =
    missing.length > READINESS_MAX_MISSING
      ? "insufficient_data"
      : failed.length >= 2
        ? "red"
        : failed.length === 1
          ? "amber"
          : "green";
  const basedOn = `${checks.length - missing.length} of ${checks.length} checks`;
  steps.push({
    rule: "readiness_verdict",
    detail:
      colour === "insufficient_data"
        ? `${missing.length} checks are missing (${missing.join(", ")}), more than ${READINESS_MAX_MISSING}, so there is too little data for a colour.`
        : `${failed.length} of ${checks.length - missing.length} available checks failed` +
          (failed.length ? ` (${failed.join(", ")})` : "") +
          `: ${colour} (0 green, 1 amber, 2 or more red).`,
  });

  return { as_of: asOf, colour, checks, failed, missing, based_on: basedOn, flags, how_built: steps };
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

function hrvMean(nights: Night[], asOf: LocalDate, days: number): { mean: number | null; n: number } {
  const from = addDays(asOf, -(days - 1));
  const values = present(nights.filter((n) => n.wake_date >= from && n.wake_date <= asOf).map((n) => n.hrv_avg_ms));
  return { mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 1) : null, n: values.length };
}

export function trend(nights: Night[], dailies: Daily[], asOf: LocalDate): Trend {
  const steps: Step[] = [];
  const last = nights.find((n) => n.wake_date === asOf) ?? null;
  const hrvLast = last?.hrv_avg_ms ?? null;
  steps.push({
    rule: "hrv_last",
    detail:
      hrvLast === null
        ? `No HRV for the ${nightLabel(asOf)}; no earlier night is used in its place.`
        : `Last night's HRV (${nightLabel(asOf)}) is ${hrvLast} ms.`,
  });

  const short = hrvMean(nights, asOf, HRV_SHORT_WINDOW_DAYS);
  const long = hrvMean(nights, asOf, HRV_LONG_WINDOW_DAYS);
  steps.push({
    rule: "hrv_means",
    detail:
      `HRV means average the nights that have HRV: ${short.n} of the last ${HRV_SHORT_WINDOW_DAYS} ` +
      `and ${long.n} of the last ${HRV_LONG_WINDOW_DAYS}, ending ${asOf}.`,
  });

  // The latest band the device gave on or before asOf.
  const banded = nights
    .filter((n) => n.wake_date <= asOf && n.hrv_baseline_low_ms !== null && n.hrv_baseline_high_ms !== null)
    .sort((a, b) => (a.wake_date < b.wake_date ? -1 : 1));
  const band = banded[banded.length - 1] ?? null;
  steps.push({
    rule: "hrv_baseline",
    detail: band
      ? `HRV baseline band ${band.hrv_baseline_low_ms}-${band.hrv_baseline_high_ms} ms is the device's, from the ${band.label}.`
      : "The device has given no HRV baseline band yet.",
  });

  const rhrLast = dailies.find((d) => d.date === asOf)?.resting_hr_bpm ?? null;
  const rhr = restingHrBaseline(dailies, asOf);
  steps.push({
    rule: "resting_hr_mean",
    detail: `Resting HR mean is over the ${RESTING_HR_WINDOW_DAYS} days before ${asOf} (today excluded), from ${rhr.days} days with data.`,
  });

  const have = new Set(nights.map((n) => n.wake_date));
  const missing = dateRange(addDays(asOf, -(HRV_SHORT_WINDOW_DAYS - 1)), asOf).filter((d) => !have.has(d));
  steps.push({
    rule: "missing_nights",
    detail: `${HRV_SHORT_WINDOW_DAYS - missing.length} of the last ${HRV_SHORT_WINDOW_DAYS} nights are recorded.`,
  });

  return {
    as_of: asOf,
    hrv_last_ms: hrvLast,
    hrv_7d_mean_ms: short.mean,
    hrv_60d_mean_ms: long.mean,
    hrv_baseline_low_ms: band?.hrv_baseline_low_ms ?? null,
    hrv_baseline_high_ms: band?.hrv_baseline_high_ms ?? null,
    resting_hr_last_bpm: rhrLast,
    resting_hr_30d_mean_bpm: rhr.mean_bpm,
    missing_nights: missing,
    steps,
  };
}
