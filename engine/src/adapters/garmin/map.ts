/**
 * Garmin Connect responses -> canonical records. Pure functions: no I/O, no
 * clock. Field choices follow the Python loader (loader/fieldmap.py,
 * fetcher/normalise.py), which was verified against the same responses.
 *
 * Units in these responses: durations in seconds, distance in metres, speed
 * m/s, sleep stages in seconds, sleep timestamps in epoch ms (the "Local"
 * variant is local wall clock encoded as if it were UTC).
 */

import type {
  Daily,
  Flag,
  HrZone,
  Lap,
  LocalDate,
  Night,
  NightValidation,
  Provenance,
  Sample,
  Score,
  Session,
  SessionType,
  Step,
  TrainingEffect,
} from "../../model.ts";
import type { FitActivity, FitLap, FitSession } from "./fit.ts";
import { RECOVERY_CAP_H } from "./fit.ts";
import { offsetMinutes, toLocalIso, tzName, wallClockMs, wallToLocalIso } from "./time.ts";

export interface MapOptions {
  /** The user's home IANA zone, reported as `tz` when the data's offset matches it. */
  tz?: string;
}

type Obj = Record<string, unknown>;

// ------------------------------------------------------------------ helpers

export function obj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round(value: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function secToMin(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : round(n / 60, 1);
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function step(rule: string, detail: string): Step {
  return { rule, detail };
}

function provenance(source: string, ids: Array<string | number | null | undefined>, steps: Step[]): Provenance {
  return {
    vendor: "garmin",
    source,
    record_ids: ids.filter((id) => id !== null && id !== undefined && id !== "").map(String),
    steps,
  };
}

function partialFlag(missing: string[], what: string): Flag[] {
  if (missing.length === 0) return [];
  return [{
    code: "partial",
    severity: "info",
    message: `${what} has no ${missing.join(", ")}.`,
  }];
}

/** "IMPROVING_VO2_MAX_13" -> "IMPROVING_VO2_MAX": the suffix is a message id, not a value. */
export function stripMessageId(value: unknown): string | null {
  const text = str(value);
  if (text === null) return null;
  return text.replace(/_\d+$/, "") || null;
}

export function nightLabel(wakeDate: LocalDate): string {
  const prev = new Date(Date.parse(`${wakeDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `night of ${prev} into ${wakeDate}`;
}

// -------------------------------------------------------------------- night

/** Garmin's sleepWindowConfirmationType, in its several spellings. */
export function sleepValidation(value: unknown): { validation: NightValidation; flags: Flag[]; note: string | null } {
  const raw = str(value)?.toUpperCase().replace(/[-\s]/g, "_") ?? null;
  if (raw === null) return { validation: "device", flags: [], note: null };
  if (raw.includes("OFF_WRIST") || raw.includes("OFFWRIST")) {
    return {
      validation: "off_wrist",
      flags: [{ code: "off_wrist", severity: "warn", message: "Garmin says the watch was off the wrist for this night." }],
      note: raw,
    };
  }
  if (raw.startsWith("MANUAL")) {
    return {
      validation: "user_reported",
      flags: [{ code: "user_reported", severity: "info", message: "The sleep window was set or corrected by hand, not detected by the watch." }],
      note: raw,
    };
  }
  return { validation: "device", flags: [], note: raw };
}

const SLEEP_MEASURES = ["sleepTimeSeconds", "deepSleepSeconds", "lightSleepSeconds", "remSleepSeconds"];

/**
 * One night from a `sleep` response and (optionally) the `hrv` response for
 * the same calendar date. Null when Garmin has nothing measured for the night
 * (it returns an all-null record for nights the watch was not worn or has
 * not synced); that gap is for the caller to report as `not_synced`.
 */
export function mapNight(sleep: unknown, hrv: unknown, date: LocalDate, opts: MapOptions = {}): Night | null {
  const body = obj(sleep);
  const dto = obj(body?.dailySleepDTO);
  if (!dto) return null;
  const score = num(obj(obj(dto.sleepScores)?.overall)?.value);
  if (!SLEEP_MEASURES.some((k) => num(dto[k]) !== null) && score === null) return null;

  const startGmt = num(dto.sleepStartTimestampGMT);
  const endGmt = num(dto.sleepEndTimestampGMT);
  const offset = offsetMinutes(dto.sleepStartTimestampLocal, startGmt) ??
    offsetMinutes(dto.sleepEndTimestampLocal, endGmt);
  if (startGmt === null || endGmt === null || offset === null) return null;

  const wakeDate = str(dto.calendarDate) ?? date;
  const steps: Step[] = [
    step("wake_day_dating", `Dated by wake day: Garmin's calendarDate ${wakeDate} is the day the sleep ended.`),
    step("tz_from_local_gmt", "UTC offset taken from the difference between Garmin's local and GMT sleep timestamps."),
    step("seconds_to_minutes", "Sleep and stage durations converted from seconds to minutes."),
  ];
  const v = sleepValidation(dto.sleepWindowConfirmationType);
  if (v.note) steps.push(step("sleep_validation", `Garmin sleep-window confirmation: ${v.note.toLowerCase()}.`));
  if (v.note?.includes("TENTATIVE")) {
    steps.push(step("tentative_night", "Garmin marks this night tentative; its numbers may still change."));
  }

  let sleepScore: Score | null = null;
  if (score !== null) {
    const label = str(obj(obj(dto.sleepScores)?.overall)?.qualifierKey);
    sleepScore = { value: score, min: 0, max: 100, ...(label ? { label } : {}) };
  }

  const summary = obj(obj(hrv)?.hrvSummary);
  const baseline = obj(summary?.baseline);
  let hrvAvg = num(summary?.lastNightAvg);
  if (hrvAvg !== null) {
    steps.push(step("hrv_from_hrv_summary", "HRV is Garmin's overnight average (hrvSummary.lastNightAvg); the baseline band is its balanced range."));
  } else {
    hrvAvg = num(body?.avgOvernightHrv);
    if (hrvAvg !== null) steps.push(step("hrv_from_sleep", "HRV is the overnight average from the sleep response; no HRV summary was available."));
  }

  const night: Night = {
    wake_date: wakeDate,
    label: nightLabel(wakeDate),
    start: toLocalIso(startGmt, offset),
    end: toLocalIso(endGmt, offset),
    tz: tzName(opts.tz, startGmt, offset),
    asleep_min: secToMin(dto.sleepTimeSeconds),
    deep_min: secToMin(dto.deepSleepSeconds),
    light_min: secToMin(dto.lightSleepSeconds),
    rem_min: secToMin(dto.remSleepSeconds),
    awake_min: secToMin(dto.awakeSleepSeconds),
    score: sleepScore,
    hrv_avg_ms: hrvAvg,
    hrv_baseline_low_ms: num(baseline?.balancedLow),
    hrv_baseline_high_ms: num(baseline?.balancedUpper),
    resting_hr_bpm: num(body?.restingHeartRate),
    respiration_brpm: num(dto.averageRespirationValue),
    validation: v.validation,
    flags: [],
    provenance: provenance(
      hrvAvg !== null && summary ? "garmin:sleep+hrv" : "garmin:sleep",
      [num(dto.id), summary ? `hrv:${wakeDate}` : null],
      steps,
    ),
  };

  const missing: string[] = [];
  if (night.asleep_min === null) missing.push("total sleep");
  if (night.deep_min === null && night.rem_min === null) missing.push("sleep stages");
  if (night.score === null) missing.push("sleep score");
  if (night.hrv_avg_ms === null) missing.push("HRV");
  night.flags = [...v.flags, ...partialFlag(missing, `The ${night.label}`)];
  return night;
}

// -------------------------------------------------------------------- daily

const DAILY_MEASURES = [
  "restingHeartRate", "totalSteps", "averageStressLevel", "bodyBatteryHighestValue",
  "bodyBatteryLowestValue", "moderateIntensityMinutes", "vigorousIntensityMinutes",
];

export function mapDaily(summary: unknown, date: LocalDate): Daily | null {
  const d = obj(summary);
  if (!d) return null;
  const stressRaw = num(d.averageStressLevel);
  const hasMeasure = DAILY_MEASURES.some((k) => {
    const n = num(d[k]);
    // Intensity minutes are 0, not null, on days with no data; stress is -1.
    return n !== null && n > 0;
  });
  if (!hasMeasure) return null;

  const day = str(d.calendarDate) ?? date;
  const steps: Step[] = [];
  let stress: Score | null = null;
  if (stressRaw !== null && stressRaw >= 0) {
    const label = str(d.stressQualifier);
    stress = { value: stressRaw, min: 0, max: 100, ...(label && label !== "UNKNOWN" ? { label } : {}) };
  } else if (stressRaw !== null) {
    steps.push(step("stress_unmeasured", `Garmin's average stress ${stressRaw} is a "not measured" marker, not a level; reported as missing.`));
  }

  const moderate = num(d.moderateIntensityMinutes);
  const vigorous = num(d.vigorousIntensityMinutes);
  const intensity = moderate === null && vigorous === null ? null : (moderate ?? 0) + 2 * (vigorous ?? 0);
  if (intensity !== null) {
    steps.push(step("intensity_minutes", "Intensity minutes = moderate + 2 x vigorous, as Garmin counts them toward the weekly goal."));
  }

  const daily: Daily = {
    date: day,
    resting_hr_bpm: num(d.restingHeartRate),
    steps: num(d.totalSteps),
    stress_avg: stress,
    energy_high: num(d.bodyBatteryHighestValue),
    energy_low: num(d.bodyBatteryLowestValue),
    intensity_min: intensity,
    flags: [],
    provenance: provenance("garmin:daily_summary", [`daily_summary:${day}`], steps),
  };

  const flags: Flag[] = [];
  const covered = num(d.durationInMilliseconds);
  if (covered !== null && covered < 86_400_000) {
    const until = str(d.wellnessEndTimeLocal)?.slice(11, 16);
    flags.push({
      code: "partial",
      severity: "info",
      message: `This day was still in progress at the last sync${until ? ` (data up to ${until})` : ""}.`,
    });
  }
  const missing: string[] = [];
  if (daily.resting_hr_bpm === null) missing.push("resting HR");
  if (daily.stress_avg === null) missing.push("stress");
  if (daily.energy_high === null) missing.push("Body Battery");
  flags.push(...partialFlag(missing, `${day}`));
  daily.flags = flags;
  return daily;
}

// ------------------------------------------------------------------ session

const TYPE_MAP: Record<string, SessionType> = {
  running: "running",
  treadmill_running: "running",
  trail_running: "running",
  track_running: "running",
  indoor_running: "running",
  virtual_run: "running",
  walking: "walking",
  casual_walking: "walking",
  speed_walking: "walking",
  hiking: "walking",
  cycling: "cycling",
  road_biking: "cycling",
  mountain_biking: "cycling",
  gravel_cycling: "cycling",
  indoor_cycling: "cycling",
  virtual_ride: "cycling",
  lap_swimming: "swimming",
  open_water_swimming: "swimming",
  swimming: "swimming",
  strength_training: "strength",
  indoor_cardio: "cardio",
  hiit: "cardio",
  elliptical: "cardio",
  stair_climbing: "cardio",
  indoor_rowing: "cardio",
};

export function sessionType(typeKey: string): SessionType {
  const key = typeKey.toLowerCase();
  if (TYPE_MAP[key]) return TYPE_MAP[key];
  if (/run/.test(key)) return "running";
  if (/cycl|bik|ride/.test(key)) return "cycling";
  if (/swim/.test(key)) return "swimming";
  if (/walk|hik/.test(key)) return "walking";
  return "other";
}

/** FIT sport/sub_sport -> a Connect-style type key, for sessions known only from the file. */
function fitTypeKey(sport: string | null, subSport: string | null): string {
  const snake = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (sport === "training" && subSport === "strengthTraining") return "strength_training";
  if (sport === "training" && subSport === "cardioTraining") return "indoor_cardio";
  if (sport && subSport && subSport !== "generic") {
    const sub = snake(subSport);
    const base = snake(sport);
    return sub.includes(base) ? sub : `${sub}_${base}`;
  }
  return sport ? snake(sport) : "unknown";
}

/** Cadence in steps/min: running and walking devices count one foot. */
function stepsPerMinute(type: SessionType, deviceCadence: number | null): number | null {
  if (deviceCadence === null || deviceCadence <= 0) return null;
  return type === "running" || type === "walking" ? round(deviceCadence * 2, 1) : null;
}

const HARD_ZONE_KEYS = ["hrTimeInZone_4", "hrTimeInZone_5", "hrTimeInZone_6"];

/** One activity from an `activities` list item. */
export function mapSession(item: unknown, opts: MapOptions = {}): Session | null {
  const a = obj(item);
  const id = a?.activityId;
  if (!a || (typeof id !== "number" && typeof id !== "string")) return null;
  const startWall = wallClockMs(a.startTimeLocal);
  const startUtc = wallClockMs(a.startTimeGMT);
  const offset = offsetMinutes(a.startTimeLocal, a.startTimeGMT);
  if (startWall === null || startUtc === null || offset === null) return null;

  const vendorType = str(obj(a.activityType)?.typeKey) ?? str(a.activityType) ?? "unknown";
  const type = sessionType(vendorType);
  const elapsedS = num(a.elapsedDuration) ?? num(a.duration) ?? 0;
  const endUtc = wallClockMs(a.endTimeGMT) ?? startUtc + elapsedS * 1000;

  const steps: Step[] = [
    step("tz_from_local_gmt", "UTC offset taken from the difference between Garmin's local and GMT start times."),
    step("seconds_to_minutes", "Duration converted from seconds to minutes; distance from metres to km."),
    step("type_map", `Garmin type "${vendorType}" read as ${type}.`),
  ];

  const zoneSecs = HARD_ZONE_KEYS.map((k) => num(a[k]));
  const hardMin = zoneSecs.some((v) => v !== null)
    ? round(zoneSecs.reduce<number>((sum, v) => sum + (v ?? 0), 0) / 60, 1)
    : null;
  if (hardMin !== null) steps.push(step("hard_minutes", "Hard minutes = time in Garmin HR zones 4 and above."));

  const session: Session = {
    id: String(id),
    parts: [String(id)],
    type,
    vendor_type: vendorType,
    start: wallToLocalIso(startWall, offset),
    end: toLocalIso(endUtc, offset),
    tz: tzName(opts.tz, startUtc, offset),
    duration_min: secToMin(a.duration) ?? 0,
    elapsed_min: secToMin(elapsedS) ?? 0,
    distance_km: (() => {
      const m = positive(num(a.distance));
      return m === null ? null : round(m / 1000, 3);
    })(),
    avg_hr_bpm: num(a.averageHR),
    max_hr_bpm: num(a.maxHR),
    hard_min: hardMin,
    calories_kcal: num(a.calories),
    elevation_gain_m: (() => {
      const m = num(a.elevationGain);
      return m === null ? null : round(m, 1);
    })(),
    avg_cadence_spm: (() => {
      const c = positive(num(a.averageRunningCadenceInStepsPerMinute));
      return c === null ? null : round(c, 1);
    })(),
    training_effect: apiTrainingEffect(a, steps),
    recovery: apiRecovery(a, steps),
    energy_impact: num(a.differenceBodyBattery),
    flags: [],
    provenance: provenance("garmin:activities", [String(id)], steps),
  };

  const flags: Flag[] = [];
  if (a.isManualActivity === true || a.manualActivity === true) {
    flags.push({ code: "user_reported", severity: "info", message: "This activity was entered by hand, not recorded by the watch." });
  }
  const missing: string[] = [];
  if (session.avg_hr_bpm === null) missing.push("heart rate");
  flags.push(...partialFlag(missing, `Activity ${session.id}`));
  session.flags = flags;
  return session;
}

function apiTrainingEffect(a: Obj, steps: Step[]): TrainingEffect | null {
  const aerobic = num(a.aerobicTrainingEffect);
  const anaerobic = num(a.anaerobicTrainingEffect);
  const aerobicMsg = stripMessageId(a.aerobicTrainingEffectMessage);
  const anaerobicMsg = stripMessageId(a.anaerobicTrainingEffectMessage);
  const label = str(a.trainingEffectLabel) ?? aerobicMsg;
  if (aerobicMsg || anaerobicMsg) {
    steps.push(step(
      "te_message_id_stripped",
      `Garmin's training-effect messages, with the trailing message id removed: aerobic ${aerobicMsg ?? "none"}, anaerobic ${anaerobicMsg ?? "none"}.`,
    ));
  }
  if (aerobic !== null || anaerobic !== null) {
    return { aerobic, anaerobic, label, source: "api" };
  }
  if (label) {
    steps.push(step("te_label_only", "Garmin sent no numeric training effect for this activity, only its label."));
    return { aerobic: null, anaerobic: null, label, source: "label_only" };
  }
  return null;
}

function apiRecovery(a: Obj, steps: Step[]): Session["recovery"] {
  const hours = num(a.activityRecoveryHours) ?? num(a.recoveryTimeHours);
  if (hours === null) return null;
  steps.push(step("recovery_from_api", "Recovery time as reported by Garmin for this activity."));
  return { hours, basis: "device" };
}

/** A session known only from its FIT file (no Connect summary recorded). */
export function sessionFromFit(id: string, fit: FitActivity, opts: MapOptions = {}): Session | null {
  const s = fit.session;
  if (!s || s.startUtcMs === null || fit.offsetMin === null) return null;
  const vendorType = fitTypeKey(s.sport, s.subSport);
  const type = sessionType(vendorType);
  const elapsed = s.elapsed_s ?? s.timer_s ?? 0;
  const hard = hardFromFitZones(s);
  const steps: Step[] = [
    step("session_from_fit", "Built from the device file's session record; no Garmin Connect summary was available."),
    step("tz_from_fit", "UTC offset taken from the FIT activity record's local timestamp."),
    step("type_map", `FIT sport ${s.sport ?? "?"}/${s.subSport ?? "?"} read as ${type}.`),
  ];
  return {
    id,
    parts: [id],
    type,
    vendor_type: vendorType,
    start: toLocalIso(s.startUtcMs, fit.offsetMin),
    end: toLocalIso(s.startUtcMs + elapsed * 1000, fit.offsetMin),
    tz: tzName(opts.tz, s.startUtcMs, fit.offsetMin),
    duration_min: secToMin(s.timer_s) ?? 0,
    elapsed_min: secToMin(elapsed) ?? 0,
    distance_km: s.distance_m && s.distance_m > 0 ? round(s.distance_m / 1000, 3) : null,
    avg_hr_bpm: s.avg_hr,
    max_hr_bpm: s.max_hr,
    hard_min: hard,
    calories_kcal: s.calories,
    elevation_gain_m: s.ascent_m,
    avg_cadence_spm: stepsPerMinute(type, s.cadence),
    training_effect: null,
    recovery: null,
    energy_impact: null,
    flags: [{ code: "partial", severity: "info", message: `Activity ${id} has no Garmin Connect summary; Body Battery impact and training-effect label are unknown.` }],
    provenance: provenance("garmin:fit", [id], steps),
  };
}

function hardFromFitZones(s: FitSession): number | null {
  if (!s.zone_s || s.zone_s.length < 5) return null;
  return round(s.zone_s.slice(4).reduce((sum, v) => sum + v, 0) / 60, 1);
}

/** Overlay the device file's msg-140 numbers onto a session. Mutates and returns it. */
export function applyFit(session: Session, fit: Pick<FitActivity, "msg140">): Session {
  const m = fit.msg140;
  let steps = session.provenance.steps;
  if (m && (m.aerobic_te !== null || m.anaerobic_te !== null)) {
    steps = session.provenance.steps = steps.filter((s) => s.rule !== "te_label_only");
    session.training_effect = {
      aerobic: m.aerobic_te,
      anaerobic: m.anaerobic_te,
      label: session.training_effect?.label ?? null,
      source: "fit",
    };
    steps.push(step(
      "te_from_fit_msg140",
      "Training effect read from the device file's message 140 (fields 4 and 20, tenths), an undocumented record reverse-engineered and checked against Garmin Connect on 7 activities.",
    ));
  }
  if (m && m.recovery_min !== null) {
    const raw = m.recovery_min / 60;
    const hours = round(Math.min(raw, RECOVERY_CAP_H), 1);
    session.recovery = { hours, basis: "device" };
    steps.push(step(
      "recovery_from_fit_msg140",
      `Recovery time read from the device file's message 140 (field 9, minutes): the watch's total recovery after this activity, including any still owed from earlier sessions${raw >= RECOVERY_CAP_H ? `, at the watch's ${RECOVERY_CAP_H} h cap` : ""}.`,
    ));
  }
  if (m && session.provenance.source !== "garmin:fit") {
    session.provenance.source = `${session.provenance.source} + garmin:fit`;
  }
  return session;
}

// ------------------------------------------------------------ detail parts

export function lapsFromSplits(splits: unknown): Lap[] {
  const list = obj(splits)?.lapDTOs;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, i): Lap[] => {
    const l = obj(item);
    if (!l) return [];
    const distance = num(l.distance) ?? 0;
    const cadence = positive(num(l.averageRunCadence));
    const stride = positive(num(l.strideLength));
    return [{
      index: num(l.lapIndex) ?? i + 1,
      distance_km: round(distance / 1000, 3),
      duration_min: secToMin(l.duration) ?? 0,
      moving_min: secToMin(l.movingDuration) ?? secToMin(l.duration) ?? 0,
      avg_hr_bpm: num(l.averageHR),
      max_hr_bpm: num(l.maxHR),
      avg_cadence_spm: cadence === null ? null : round(cadence, 1),
      stride_cm: stride === null ? null : round(stride, 1),
      elevation_gain_m: num(l.elevationGain),
      elevation_loss_m: num(l.elevationLoss),
    }];
  });
}

export function lapsFromFit(laps: FitLap[], type: SessionType): Lap[] {
  return laps.map((l, i) => ({
    index: i + 1,
    distance_km: round((l.distance_m ?? 0) / 1000, 3),
    duration_min: secToMin(l.timer_s) ?? 0,
    moving_min: secToMin(l.moving_s ?? l.timer_s) ?? 0,
    avg_hr_bpm: l.avg_hr,
    max_hr_bpm: l.max_hr,
    avg_cadence_spm: stepsPerMinute(type, l.cadence),
    stride_cm: l.step_length_mm === null ? null : round(l.step_length_mm / 10, 1),
    elevation_gain_m: l.ascent_m,
    elevation_loss_m: l.descent_m,
  }));
}

export function zonesFromApi(zones: unknown): HrZone[] {
  if (!Array.isArray(zones)) return [];
  return zones.flatMap((item): HrZone[] => {
    const z = obj(item);
    const zone = num(z?.zoneNumber);
    const low = num(z?.zoneLowBoundary);
    if (!z || zone === null || low === null) return [];
    return [{ zone, low_bpm: low, minutes: secToMin(z.secsInZone) ?? 0 }];
  });
}

/** FIT time_in_zone: index 0 is time below zone 1; zone i starts at bounds[i-1]. */
export function zonesFromFit(s: FitSession | null): HrZone[] {
  if (!s?.zone_s || !s.zone_bounds) return [];
  const out: HrZone[] = [];
  for (let zone = 1; zone <= 5; zone++) {
    const low = s.zone_bounds[zone - 1];
    const secs = s.zone_s[zone];
    if (low === undefined || secs === undefined) break;
    out.push({ zone, low_bpm: low, minutes: round(secs / 60, 1) });
  }
  return out;
}

export function hardFromZones(zones: HrZone[]): number | null {
  if (zones.length === 0) return null;
  return round(zones.filter((z) => z.zone >= 4).reduce((sum, z) => sum + z.minutes, 0), 1);
}

export function samplesFromFit(fit: FitActivity, offsetMin: number, type: SessionType): Sample[] {
  const first = fit.records[0]?.utcMs;
  if (first === undefined) return [];
  return fit.records.map((r) => ({
    t: toLocalIso(r.utcMs, offsetMin),
    elapsed_s: Math.round((r.utcMs - first) / 1000),
    hr_bpm: r.hr_bpm,
    speed_mps: r.speed_mps,
    cadence_spm: stepsPerMinute(type, r.cadence),
    elevation_m: r.elevation_m,
    distance_m: r.distance_m,
  }));
}

/** Samples from get_activity_details: a column table described by metricDescriptors. */
export function samplesFromDetails(details: unknown, offsetMin: number): Sample[] {
  const d = obj(details);
  const descriptors = d?.metricDescriptors;
  const rows = d?.activityDetailMetrics;
  if (!Array.isArray(descriptors) || !Array.isArray(rows)) return [];
  const col: Record<string, number> = {};
  for (const item of descriptors) {
    const desc = obj(item);
    const key = str(desc?.key);
    const index = num(desc?.metricsIndex);
    if (key && index !== null) col[key] = index;
  }
  const pick = (metrics: unknown[], ...keys: string[]): number | null => {
    for (const key of keys) {
      const index = col[key];
      if (index !== undefined) {
        const v = num(metrics[index]);
        if (v !== null) return v;
      }
    }
    return null;
  };
  const out: Sample[] = [];
  let firstTs: number | null = null;
  for (const row of rows) {
    const metrics = obj(row)?.metrics;
    if (!Array.isArray(metrics)) continue;
    const ts = pick(metrics, "directTimestamp");
    if (ts === null) continue;
    firstTs ??= ts;
    out.push({
      t: toLocalIso(ts, offsetMin),
      elapsed_s: Math.round(pick(metrics, "sumElapsedDuration") ?? (ts - firstTs) / 1000),
      hr_bpm: pick(metrics, "directHeartRate"),
      speed_mps: pick(metrics, "directSpeed"),
      cadence_spm: pick(metrics, "directDoubleCadence"),
      elevation_m: pick(metrics, "directElevation", "directCorrectedElevation", "directUncorrectedElevation"),
      distance_m: pick(metrics, "sumDistance"),
    });
  }
  return out;
}
