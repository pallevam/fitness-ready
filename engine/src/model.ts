/**
 * The canonical model: every vendor adapter produces these records, and every
 * rule and tool consumes them. This file is the contract between the parallel
 * parts of the engine; change it deliberately.
 *
 * Conventions an AI assistant can't misread (research finding F6):
 * - Units live in field names: `_min`, `_bpm`, `_ms`, `_km`, `_m`, `_h`, `_spm`.
 * - Scores carry their scale; a 1-4 score is never presented as out of 100.
 * - Times are local ISO-8601 with offset ("2026-11-05T02:59:00+05:30"); `tz`
 *   names the zone. Dates are the user's local calendar dates.
 * - A night is dated by the day the user woke (`wake_date`), and says so.
 * - Every record carries `flags` (what not to trust) and `provenance` (how it
 *   was built), so an answer can show its work (the A1 proof).
 */

export type Vendor = "garmin" | "oura" | "whoop" | "apple" | "user";

/** YYYY-MM-DD, the user's local calendar date. */
export type LocalDate = string;
/** ISO-8601 local date-time with offset, e.g. 2026-11-05T02:59:00+05:30. */
export type LocalDateTime = string;

export interface DateRange {
  start: LocalDate;
  end: LocalDate; // inclusive
}

// ---------------------------------------------------------------- provenance

/** One step in how a value was produced: fetched, converted, merged, assumed. */
export interface Step {
  /** Stable rule id, e.g. "wake_day_dating", "merge_split_session". */
  rule: string;
  /** One plain sentence a user could read. */
  detail: string;
}

export interface Provenance {
  vendor: Vendor;
  /** Where the raw data came from, e.g. "garmin:sleep" or "garmin:fit". */
  source: string;
  /** Vendor record ids this record was built from. */
  record_ids: string[];
  steps: Step[];
}

// --------------------------------------------------------------------- flags

export type FlagCode =
  | "not_synced" // the expected record is missing (e.g. last night)
  | "off_wrist" // the vendor says the device was not worn
  | "user_reported" // entered by the user, not measured
  | "imputed" // some values filled from averages
  | "partial" // record exists but key fields are missing
  | "sensor_spike" // a value is physiologically implausible
  | "merged_parts" // several vendor records joined into one session
  | "assumed" // a value the device did not give, assumed by a rule
  | "stale"; // data older than the question needs

export interface Flag {
  code: FlagCode;
  severity: "info" | "warn";
  /** One plain sentence, e.g. "Max HR 181 is a 9-second spike; likely a sensor artefact." */
  message: string;
  /** The field the flag is about, if any. */
  field?: string;
}

/** A vendor score with its scale, so 1-4 and 0-100 can't be confused. */
export interface Score {
  value: number;
  min: number;
  max: number;
  /** The vendor's own wording, if any (e.g. "GOOD"). */
  label?: string;
}

interface Base {
  flags: Flag[];
  provenance: Provenance;
}

// --------------------------------------------------------------------- night

export type NightValidation = "device" | "user_reported" | "imputed" | "off_wrist";

export interface Night extends Base {
  /** The day the user woke: the night of wake_date-1 into wake_date. */
  wake_date: LocalDate;
  /** "night of 2026-11-04 into 2026-11-05" */
  label: string;
  start: LocalDateTime;
  end: LocalDateTime;
  tz: string;
  asleep_min: number | null;
  deep_min: number | null;
  light_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  score: Score | null;
  hrv_avg_ms: number | null;
  /** The vendor's personal HRV baseline band for this night, if given. */
  hrv_baseline_low_ms: number | null;
  hrv_baseline_high_ms: number | null;
  resting_hr_bpm: number | null;
  respiration_brpm: number | null;
  validation: NightValidation;
}

// ------------------------------------------------------------------- session

export type SessionType =
  | "running"
  | "walking"
  | "cycling"
  | "swimming"
  | "strength"
  | "cardio"
  | "other";

export interface TrainingEffect {
  /** 0-5, vendor scale. Null when only labels are available. */
  aerobic: number | null;
  anaerobic: number | null;
  /** Vendor's label, e.g. "LACTATE_THRESHOLD". */
  label: string | null;
  /** Where the numbers came from: the vendor API or the device file. */
  source: "api" | "fit" | "label_only";
}

export interface Recovery {
  hours: number;
  /** "device": the device computed it; "assumed": a rule filled it in. */
  basis: "device" | "assumed";
}

export interface Session extends Base {
  /** Stable id: the first part's vendor id. */
  id: string;
  /** Vendor ids of every part; more than one means it was saved in parts. */
  parts: string[];
  type: SessionType;
  /** The vendor's own type key, e.g. "indoor_cardio". */
  vendor_type: string;
  start: LocalDateTime;
  end: LocalDateTime;
  tz: string;
  /** Timer time, excluding pauses. */
  duration_min: number;
  /** Wall-clock time from first start to last stop, including gaps. */
  elapsed_min: number;
  distance_km: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  /** Minutes at or above the vendor's zone 4. */
  hard_min: number | null;
  calories_kcal: number | null;
  elevation_gain_m: number | null;
  avg_cadence_spm: number | null;
  training_effect: TrainingEffect | null;
  recovery: Recovery | null;
  /** Vendor energy-score impact (e.g. Garmin Body Battery), negative = cost. */
  energy_impact: number | null;
}

/** One time-series point within a session, for artefact checks and detail. */
export interface Sample {
  t: LocalDateTime;
  elapsed_s: number;
  hr_bpm: number | null;
  speed_mps: number | null;
  cadence_spm: number | null;
  elevation_m: number | null;
  distance_m: number | null;
}

export interface Lap {
  index: number;
  distance_km: number;
  duration_min: number;
  moving_min: number;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  avg_cadence_spm: number | null;
  stride_cm: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
}

export interface HrZone {
  zone: number; // 1-5
  low_bpm: number;
  minutes: number;
}

/** Everything known about one session; fetched on demand, never in bulk. */
export interface SessionDetail extends Base {
  session: Session;
  laps: Lap[];
  zones: HrZone[];
  samples: Sample[];
}

// --------------------------------------------------------------------- daily

export interface Daily extends Base {
  date: LocalDate;
  resting_hr_bpm: number | null;
  steps: number | null;
  stress_avg: Score | null;
  /** Vendor energy score range for the day (Garmin Body Battery 0-100). */
  energy_high: number | null;
  energy_low: number | null;
  intensity_min: number | null;
}
