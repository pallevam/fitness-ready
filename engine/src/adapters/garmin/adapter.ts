/**
 * Garmin -> canonical model. Reads Garmin Connect responses through a
 * RawSource (recorded snapshots in development) under these keys:
 *
 *   sleep/<date>, hrv/<date>, daily_summary/<date>, activities/<date>
 *   activity_splits/<id>, hr_zones/<id>, activity_details/<id>, fit/<id> (bytes)
 */

import type { Adapter, RawSource } from "../../adapter.ts";
import type { Daily, DateRange, Flag, LocalDate, Night, Session, SessionDetail, Step } from "../../model.ts";
import { decodeFit, type FitActivity, type FitMsg140, readFitMsg140 } from "./fit.ts";
import {
  applyFit,
  hardFromZones,
  lapsFromFit,
  lapsFromSplits,
  mapDaily,
  mapNight,
  mapSession,
  type MapOptions,
  samplesFromDetails,
  samplesFromFit,
  sessionFromFit,
  zonesFromApi,
  zonesFromFit,
} from "./map.ts";
import { addDays, datesIn } from "./time.ts";

export type GarminAdapterOptions = MapOptions;

export class GarminAdapter implements Adapter {
  readonly vendor = "garmin" as const;
  readonly #source: RawSource;
  readonly #opts: MapOptions;
  /** Message 140 per activity id, decoded at most once per adapter instance. */
  readonly #msg140 = new Map<string, Promise<FitMsg140 | null>>();

  constructor(source: RawSource, opts: GarminAdapterOptions = {}) {
    this.#source = source;
    this.#opts = opts;
  }

  async nights(range: DateRange): Promise<Night[]> {
    const out: Night[] = [];
    for (const date of datesIn(range.start, range.end)) {
      const sleep = await this.#source.json(`sleep/${date}`);
      if (sleep === null) continue;
      const hrv = await this.#source.json(`hrv/${date}`);
      const night = mapNight(sleep, hrv, date, this.#opts);
      if (night && night.wake_date >= range.start && night.wake_date <= range.end) out.push(night);
    }
    return out;
  }

  async sessions(range: DateRange): Promise<Session[]> {
    const out: Session[] = [];
    for (const date of datesIn(range.start, range.end)) {
      const list = await this.#source.json(`activities/${date}`);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const session = mapSession(item, this.#opts);
        const day = session?.start.slice(0, 10);
        if (session && day && day >= range.start && day <= range.end) out.push(session);
      }
    }
    // A snapshot can list the same activity under two dates; keep one.
    const seen = new Set<string>();
    const sessions = out
      .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
      .sort((a, b) => a.start.localeCompare(b.start));
    // The device file is the only source of numeric training effect and
    // recovery on watches that send labels only; read just message 140.
    const found = await Promise.all(sessions.map((s) => this.#fitMsg140(s.id)));
    sessions.forEach((s, i) => {
      const msg140 = found[i];
      if (msg140) applyFit(s, { msg140 });
    });
    return sessions;
  }

  #fitMsg140(id: string): Promise<FitMsg140 | null> {
    let pending = this.#msg140.get(id);
    if (!pending) {
      pending = this.#source.bytes(`fit/${id}`).then((b) => (b ? readFitMsg140(b) : null), () => null);
      this.#msg140.set(id, pending);
    }
    return pending;
  }

  async dailies(range: DateRange): Promise<Daily[]> {
    const out: Daily[] = [];
    for (const date of datesIn(range.start, range.end)) {
      const daily = mapDaily(await this.#source.json(`daily_summary/${date}`), date);
      if (daily) out.push(daily);
    }
    return out;
  }

  async sessionDetail(vendorId: string): Promise<SessionDetail | null> {
    if (!/^\d+$/.test(vendorId)) return null;
    const used: string[] = [];
    const steps: Step[] = [];
    const flags: Flag[] = [];

    const [fitBytes, splits, zonesRaw, details] = await Promise.all([
      this.#source.bytes(`fit/${vendorId}`),
      this.#source.json(`activity_splits/${vendorId}`),
      this.#source.json(`hr_zones/${vendorId}`),
      this.#source.json(`activity_details/${vendorId}`),
    ]);

    let fit: FitActivity | null = null;
    if (fitBytes) {
      try {
        fit = decodeFit(fitBytes);
        used.push("fit");
        if (fit.errors.length) {
          flags.push({ code: "partial", severity: "warn", message: `The device file decoded with errors: ${fit.errors.join("; ")}.` });
        }
      } catch (error) {
        flags.push({ code: "partial", severity: "warn", message: `The device file could not be read (${(error as Error).message}).` });
      }
    }

    // Find the Connect summary: the activities file is per local start date.
    let session: Session | null = null;
    for (const date of this.#candidateDates(fit, splits)) {
      const list = await this.#source.json(`activities/${date}`);
      const item = Array.isArray(list)
        ? list.find((a) => String((a as { activityId?: unknown })?.activityId) === vendorId)
        : undefined;
      if (item) {
        session = mapSession(item, this.#opts);
        if (session) used.push("activities");
        break;
      }
    }
    if (!session && fit) session = sessionFromFit(vendorId, fit, this.#opts);
    if (!session) return null;
    if (fit) applyFit(session, fit);

    const offset = offsetOf(session.start);

    let laps = lapsFromSplits(splits);
    if (laps.length) used.push("activity_splits");
    else if (fit?.laps.length) {
      laps = lapsFromFit(fit.laps, session.type);
      steps.push(step("laps_from_fit", "Laps read from the device file; no Connect splits were available."));
    }

    let zones = zonesFromApi(zonesRaw);
    if (zones.length) used.push("hr_zones");
    else if (fit) {
      zones = zonesFromFit(fit.session);
      if (zones.length) steps.push(step("zones_from_fit", "HR zones read from the device file's time-in-zone record (time below zone 1 left out)."));
    }
    const hard = hardFromZones(zones);
    if (hard !== null) {
      session.hard_min = hard;
      steps.push(step("hard_minutes", "Hard minutes = time in HR zones 4 and 5."));
    }

    let samples = fit ? samplesFromFit(fit, offset, session.type) : [];
    if (samples.length === 0) {
      samples = samplesFromDetails(details, offset);
      if (samples.length) {
        used.push("activity_details");
        steps.push(step("samples_from_details", "Samples read from Garmin Connect's activity chart data; no device file was available."));
      }
    } else if (session.type === "running" || session.type === "walking") {
      steps.push(step("cadence_doubled", "Device cadence counts one foot; doubled to steps per minute for running and walking."));
    }

    const missing: string[] = [];
    if (laps.length === 0) missing.push("laps");
    if (zones.length === 0) missing.push("HR zones");
    if (samples.length === 0) missing.push("samples");
    if (missing.length) {
      flags.push({ code: "partial", severity: "info", message: `Activity ${vendorId} detail has no ${missing.join(", ")}.` });
    }

    return {
      session,
      laps,
      zones,
      samples,
      flags,
      provenance: {
        vendor: "garmin",
        source: used.map((u) => `garmin:${u}`).join(" + ") || "garmin",
        record_ids: [vendorId],
        steps: [step("gps_excluded", "Location fields are never read from any source."), ...steps],
      },
    };
  }

  /** Local dates the activity could be filed under, best guess first. */
  #candidateDates(fit: FitActivity | null, splits: unknown): LocalDate[] {
    const dates: LocalDate[] = [];
    const startUtc = fit?.session?.startUtcMs ?? null;
    if (startUtc !== null && fit?.offsetMin != null) {
      dates.push(new Date(startUtc + fit.offsetMin * 60_000).toISOString().slice(0, 10));
    }
    const lap = (splits as { lapDTOs?: Array<{ startTimeGMT?: unknown }> } | null)?.lapDTOs?.[0];
    if (typeof lap?.startTimeGMT === "string") {
      const gmtDate = lap.startTimeGMT.slice(0, 10);
      dates.push(gmtDate, addDays(gmtDate, 1), addDays(gmtDate, -1));
    }
    return [...new Set(dates)];
  }
}

function step(rule: string, detail: string): Step {
  return { rule, detail };
}

/** Offset minutes of a local ISO time ("...+05:30"). */
function offsetOf(local: string): number {
  const m = /([+-])(\d\d):(\d\d)$/.exec(local);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}
