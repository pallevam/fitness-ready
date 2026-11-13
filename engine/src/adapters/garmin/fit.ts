/**
 * The original device file (.fit) for one activity, decoded with Garmin's own
 * SDK. It is the only place this device (vivoactive 5) exposes numeric
 * training effect and recovery time: the Connect API sends labels only.
 *
 * Those numbers live in global message 140, which is not in the published FIT
 * profile. The SDK hands unknown messages back under their number as a key
 * (`messages["140"]`) with fields keyed by field number, when decoded with
 * `includeUnknownData: true`. The field meanings below were reverse-engineered
 * and checked against Garmin Connect on 7 real activities:
 *
 *   field 4   aerobic training effect x 10
 *   field 20  anaerobic training effect x 10
 *   field 9   recovery time, minutes (the device total after this activity,
 *             including recovery still owed from earlier sessions; caps at 96 h)
 *   field 7   VO2max x 65536 / 3.5
 */

import { Decoder, Stream } from "@garmin/fitsdk";

export const MSG_140 = "140";
export const RECOVERY_CAP_H = 96;
const FIT_EPOCH_S = 631_065_600; // 1989-12-31T00:00:00Z

type FitMesg = Record<string, unknown>;

export interface FitMsg140 {
  aerobic_te: number | null;
  anaerobic_te: number | null;
  recovery_min: number | null;
  vo2max: number | null;
}

export interface FitRecord {
  utcMs: number;
  hr_bpm: number | null;
  speed_mps: number | null;
  /** Device cadence in its own unit (strides/min for running, rpm for cycling). */
  cadence: number | null;
  elevation_m: number | null;
  distance_m: number | null;
}

export interface FitLap {
  startUtcMs: number | null;
  distance_m: number | null;
  timer_s: number | null;
  moving_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  cadence: number | null;
  step_length_mm: number | null;
  ascent_m: number | null;
  descent_m: number | null;
}

export interface FitSession {
  sport: string | null;
  subSport: string | null;
  startUtcMs: number | null;
  timer_s: number | null;
  elapsed_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  ascent_m: number | null;
  cadence: number | null;
  /** Seconds per HR zone; index 0 is below zone 1. */
  zone_s: number[] | null;
  /** Zone boundaries in bpm; zone i (1-based) starts at boundaries[i-1]. */
  zone_bounds: number[] | null;
}

export interface FitActivity {
  /** Local minus UTC, from the activity message; null if absent. */
  offsetMin: number | null;
  session: FitSession | null;
  laps: FitLap[];
  records: FitRecord[];
  msg140: FitMsg140 | null;
  errors: string[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function ms(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const n = num(value);
  return n === null ? null : (n + FIT_EPOCH_S) * 1000;
}

function numArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "number") ? (value as number[]) : null;
}

/** Cadence plus its fractional part, when the device sends one. */
function withFraction(whole: unknown, fraction: unknown): number | null {
  const w = num(whole);
  return w === null ? null : w + (num(fraction) ?? 0);
}

export function readMsg140(mesg: FitMesg | undefined): FitMsg140 | null {
  if (!mesg) return null;
  const te = (v: unknown) => {
    const n = num(v);
    return n === null || n < 0 || n > 50 ? null : n / 10;
  };
  const recovery = num(mesg[9]);
  const vo2 = num(mesg[7]);
  return {
    aerobic_te: te(mesg[4]),
    anaerobic_te: te(mesg[20]),
    recovery_min: recovery === null || recovery < 0 ? null : recovery,
    vo2max: vo2 === null || vo2 <= 0 ? null : Math.round(((vo2 * 3.5) / 65536) * 10) / 10,
  };
}

export function decodeFit(bytes: Uint8Array): FitActivity {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT()) throw new Error("not a FIT file");
  const { messages, errors } = decoder.read({ includeUnknownData: true, mergeHeartRates: true });
  const all = messages as unknown as Record<string, FitMesg[] | undefined>;

  const activity = all.activityMesgs?.[0];
  let offsetMin: number | null = null;
  const utc = activity ? ms(activity.timestamp) : null;
  const local = activity ? num(activity.localTimestamp) : null;
  if (utc !== null && local !== null) {
    offsetMin = Math.round(((local + FIT_EPOCH_S) * 1000 - utc) / 60_000 / 15) * 15;
  }

  const s = all.sessionMesgs?.[0];
  const zones = (all.timeInZoneMesgs ?? []).find((z) => z.referenceMesg === "session");
  const session: FitSession | null = s
    ? {
        sport: str(s.sport),
        subSport: str(s.subSport),
        startUtcMs: ms(s.startTime),
        timer_s: num(s.totalTimerTime),
        elapsed_s: num(s.totalElapsedTime),
        distance_m: num(s.totalDistance),
        avg_hr: num(s.avgHeartRate),
        max_hr: num(s.maxHeartRate),
        calories: num(s.totalCalories),
        ascent_m: num(s.totalAscent),
        cadence: withFraction(s.avgCadence, s.avgFractionalCadence),
        zone_s: numArray(zones?.timeInHrZone),
        zone_bounds: numArray(zones?.hrZoneHighBoundary),
      }
    : null;

  const laps: FitLap[] = (all.lapMesgs ?? []).map((l) => ({
    startUtcMs: ms(l.startTime),
    distance_m: num(l.totalDistance),
    timer_s: num(l.totalTimerTime),
    moving_s: num(l.totalMovingTime),
    avg_hr: num(l.avgHeartRate),
    max_hr: num(l.maxHeartRate),
    cadence: withFraction(l.avgCadence, l.avgFractionalCadence),
    step_length_mm: num(l.avgStepLength),
    ascent_m: num(l.totalAscent),
    descent_m: num(l.totalDescent),
  }));

  const records: FitRecord[] = [];
  for (const r of all.recordMesgs ?? []) {
    const t = ms(r.timestamp);
    if (t === null) continue;
    records.push({
      utcMs: t,
      hr_bpm: num(r.heartRate),
      speed_mps: num(r.enhancedSpeed) ?? num(r.speed),
      cadence: withFraction(r.cadence, r.fractionalCadence),
      elevation_m: num(r.enhancedAltitude) ?? num(r.altitude),
      distance_m: num(r.distance),
    });
  }

  return {
    offsetMin,
    session,
    laps,
    records,
    msg140: readMsg140(all[MSG_140]?.[0]),
    errors: errors.map((e) => e.message),
  };
}

// ------------------------------------------------- message 140 alone, cheaply

/** Integer FIT base types: id -> [size, signed, invalid-is-zero]. */
const INT_BASE: Record<number, [number, boolean, boolean]> = {
  0: [1, false, false], 1: [1, true, false], 2: [1, false, false], 3: [2, true, false],
  4: [2, false, false], 5: [4, true, false], 6: [4, false, false],
  10: [1, false, true], 11: [2, false, true], 12: [4, false, true], 13: [1, false, false],
};

function readInt(view: DataView, at: number, baseType: number, size: number, little: boolean): number | null {
  const spec = INT_BASE[baseType & 0x1f];
  if (!spec || spec[0] !== size) return null;
  const [, signed, zeroInvalid] = spec;
  let v: number;
  if (size === 1) v = signed ? view.getInt8(at) : view.getUint8(at);
  else if (size === 2) v = signed ? view.getInt16(at, little) : view.getUint16(at, little);
  else v = signed ? view.getInt32(at, little) : view.getUint32(at, little);
  const invalid = zeroInvalid ? 0 : signed ? 2 ** (size * 8 - 1) - 1 : 2 ** (size * 8) - 1;
  return v === invalid ? null : v;
}

/**
 * Read only message 140 from a FIT file, without decoding records: walks the
 * record headers and definitions and skips every other message's bytes. For
 * listing sessions, where only training effect and recovery are needed.
 * Returns null when the file has no message 140 or cannot be walked.
 */
export function readFitMsg140(bytes: Uint8Array): FitMsg140 | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14) return null;
  const headerSize = bytes[0]!;
  if (String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) !== ".FIT") return null;
  const end = Math.min(headerSize + view.getUint32(4, true), bytes.length);
  type Def = { global: number; little: boolean; fields: Array<[number, number, number, number]>; size: number };
  const local = new Map<number, Def>();
  let pos = headerSize;
  try {
    while (pos < end) {
      const header = bytes[pos++]!;
      const compressed = (header & 0x80) !== 0;
      const localNum = compressed ? (header >> 5) & 0x3 : header & 0x0f;
      if (!compressed && header & 0x40) {
        const little = bytes[pos + 1] === 0;
        const global = view.getUint16(pos + 2, little);
        const n = bytes[pos + 4]!;
        pos += 5;
        const fields: Def["fields"] = [];
        let offset = 0;
        for (let i = 0; i < n; i++, pos += 3) {
          fields.push([bytes[pos]!, offset, bytes[pos + 1]!, bytes[pos + 2]!]);
          offset += bytes[pos + 1]!;
        }
        if (header & 0x20) {
          const nDev = bytes[pos++]!;
          for (let i = 0; i < nDev; i++, pos += 3) offset += bytes[pos + 1]!;
        }
        local.set(localNum, { global, little, fields, size: offset });
        continue;
      }
      const def = local.get(localNum);
      if (!def) return null;
      if (def.global === 140) {
        const mesg: Record<number, number | null> = {};
        for (const [num, offset, size, baseType] of def.fields) {
          if (num === 4 || num === 20 || num === 9 || num === 7) {
            mesg[num] = readInt(view, pos + offset, baseType, size, def.little);
          }
        }
        return readMsg140(mesg);
      }
      pos += def.size;
    }
  } catch {
    return null; // truncated or malformed: behave as if there were no device file
  }
  return null;
}
