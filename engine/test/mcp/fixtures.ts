/**
 * Synthetic canonical records and a fake Adapter. No personal data: every
 * value is generated.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Adapter } from "../../src/adapter.ts";
import type {
  DateRange,
  Daily,
  Flag,
  LocalDate,
  Night,
  Provenance,
  Sample,
  Session,
  SessionDetail,
} from "../../src/model.ts";
import { nightLabel } from "../../src/meaning/index.ts";
import { Engine } from "../../src/mcp/engine.ts";
import { addDays } from "../../src/mcp/format.ts";
import { buildServer } from "../../src/mcp/server.ts";

export const TZ = "Asia/Kolkata";
export const OFF = "+05:30";
export const TODAY = "2026-11-13";
export const NOW = `${TODAY}T07:30:00${OFF}`;

/** True once the meaning layer has bodies (another agent fills them in). */
export const meaningReady = (() => {
  try {
    nightLabel(TODAY);
    return true;
  } catch {
    return false;
  }
})();

const prov = (source: string, id: string, rule: string): Provenance => ({
  vendor: "garmin",
  source,
  record_ids: [id],
  steps: [{ rule, detail: `Synthetic record ${id}.` }],
});

export function night(wake: LocalDate, i = 0, over: Partial<Night> = {}): Night {
  return {
    wake_date: wake,
    label: `night of ${addDays(wake, -1)} into ${wake}`,
    start: `${addDays(wake, -1)}T23:05:00${OFF}`,
    end: `${wake}T06:40:00${OFF}`,
    tz: TZ,
    asleep_min: 420 + (i % 4) * 5,
    deep_min: 80,
    light_min: 230,
    rem_min: 95,
    awake_min: 25,
    score: { value: 76 + (i % 3), min: 0, max: 100, label: "GOOD" },
    hrv_avg_ms: 58 + (i % 5) + 0.37,
    hrv_baseline_low_ms: 52,
    hrv_baseline_high_ms: 68,
    resting_hr_bpm: 51,
    respiration_brpm: 14.23,
    validation: "device",
    flags: [],
    provenance: prov("garmin:sleep", `sleep-${wake}`, "wake_day_dating"),
    ...over,
  };
}

export function daily(date: LocalDate, over: Partial<Daily> = {}): Daily {
  return {
    date,
    resting_hr_bpm: 51,
    steps: 9000,
    stress_avg: { value: 30, min: 0, max: 100 },
    energy_high: 80,
    energy_low: 20,
    intensity_min: 30,
    flags: [],
    provenance: prov("garmin:daily", `daily-${date}`, "daily_summary"),
    ...over,
  };
}

export function session(id: string, start: string, minutes: number, over: Partial<Session> = {}): Session {
  const end = new Date(Date.parse(start) + minutes * 60_000);
  // Re-render end in +05:30 so it stays a local time.
  const local = new Date(end.getTime() + 330 * 60_000).toISOString().slice(0, 19);
  return {
    id,
    parts: [id],
    type: "running",
    vendor_type: "running",
    start,
    end: `${local}${OFF}`,
    tz: TZ,
    duration_min: minutes,
    elapsed_min: minutes,
    distance_km: minutes / 6,
    avg_hr_bpm: 142,
    max_hr_bpm: 160,
    hard_min: 2,
    calories_kcal: minutes * 11,
    elevation_gain_m: 20,
    avg_cadence_spm: 168,
    training_effect: { aerobic: 2.4, anaerobic: 0.3, label: "BASE", source: "api" },
    recovery: null,
    energy_impact: -8,
    flags: [],
    provenance: prov("garmin:activity", id, "activity_summary"),
    ...over,
  };
}

/** 1 Hz samples; optionally a 3-second spike to 186 bpm at `spikeAt` seconds. */
export function samples(start: string, seconds: number, spikeAt?: number): Sample[] {
  const t0 = Date.parse(start);
  const out: Sample[] = [];
  for (let s = 0; s < seconds; s++) {
    let hr = 120 + Math.min(25, s / 20);
    if (spikeAt !== undefined && s >= spikeAt && s < spikeAt + 3) hr = [160, 186, 150][s - spikeAt]!;
    const local = new Date(t0 + s * 1000 + 330 * 60_000).toISOString().slice(0, 19);
    out.push({
      t: `${local}${OFF}`,
      elapsed_s: s,
      hr_bpm: Math.round(hr),
      speed_mps: 2.8,
      cadence_spm: 168,
      elevation_m: null,
      distance_m: s * 2.8,
    });
  }
  return out;
}

export function detail(s: Session, spikeAt?: number): SessionDetail {
  return {
    session: s,
    laps: [
      { index: 1, distance_km: 1.0, duration_min: 6.04, moving_min: 6.04, avg_hr_bpm: 140, max_hr_bpm: 150, avg_cadence_spm: 168, stride_cm: 99.6, elevation_gain_m: 3, elevation_loss_m: 2 },
      { index: 2, distance_km: 1.0, duration_min: 5.91, moving_min: 5.8, avg_hr_bpm: 146, max_hr_bpm: 155, avg_cadence_spm: 170, stride_cm: 100.2, elevation_gain_m: null, elevation_loss_m: null },
    ],
    zones: [
      { zone: 1, low_bpm: 100, minutes: 2 },
      { zone: 2, low_bpm: 120, minutes: 10.5 },
      { zone: 3, low_bpm: 140, minutes: 12 },
      { zone: 4, low_bpm: 155, minutes: 2 },
      { zone: 5, low_bpm: 170, minutes: 0 },
    ],
    samples: samples(s.start, Math.round(s.duration_min * 60), spikeAt),
    flags: [],
    provenance: prov("garmin:fit", s.id, "fit_decode"),
  };
}

export interface FakeOptions {
  /** Wake dates to leave out (e.g. TODAY for not_synced). */
  dropNights?: LocalDate[];
  /** Extra sessions per day across the whole window (payload stress). */
  extraSessionsPerDay?: number;
  nightOverrides?: Record<LocalDate, Partial<Night>>;
  fail?: boolean;
}

export class FakeAdapter implements Adapter {
  readonly vendor = "garmin" as const;
  readonly calls: { method: string; range?: DateRange; id?: string }[] = [];
  readonly allNights: Night[] = [];
  readonly allDailies: Daily[] = [];
  readonly allSessions: Session[] = [];
  readonly details = new Map<string, SessionDetail>();

  constructor(private readonly opts: FakeOptions = {}) {
    for (let i = 0; i < 120; i++) {
      const d = addDays(TODAY, -i);
      if (!opts.dropNights?.includes(d)) this.allNights.push(night(d, i, opts.nightOverrides?.[d]));
      this.allDailies.push(daily(d));
    }
    // A run saved in two parts 3 minutes apart, two days ago.
    const d2 = addDays(TODAY, -2);
    const a = session("run-a", `${d2}T06:00:00${OFF}`, 30);
    const b = session("run-b", `${d2}T06:33:00${OFF}`, 17, { distance_km: 3 });
    // A hard run yesterday with device recovery and an HR spike in its samples.
    const d1 = addDays(TODAY, -1);
    const hard = session("run-hard", `${d1}T06:00:00${OFF}`, 50, {
      training_effect: { aerobic: 3.6, anaerobic: 1.2, label: "TEMPO", source: "api" },
      recovery: { hours: 36, basis: "device" },
      hard_min: 22,
      max_hr_bpm: 186,
    });
    // An easy strength session five days ago.
    const gym = session("gym-1", `${addDays(TODAY, -5)}T18:00:00${OFF}`, 40, {
      type: "strength",
      vendor_type: "strength_training",
      distance_km: null,
      training_effect: null,
    });
    this.allSessions.push(a, b, hard, gym);
    this.details.set(a.id, detail(a));
    this.details.set(b.id, detail(b));
    this.details.set(hard.id, detail(hard, 900));
    this.details.set(gym.id, { ...detail(gym), samples: [] });

    for (let i = 0; i < 120 && opts.extraSessionsPerDay; i++) {
      for (let k = 0; k < opts.extraSessionsPerDay; k++) {
        const d = addDays(TODAY, -i);
        this.allSessions.push(session(`x-${d}-${k}`, `${d}T${String(12 + k * 3).padStart(2, "0")}:00:00${OFF}`, 35, { type: "walking", vendor_type: "walking" }));
      }
    }
    this.allSessions.sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  }

  private check(): void {
    if (this.opts.fail) throw new Error("upstream 503 for token abc123 body={...}");
  }

  async nights(range: DateRange): Promise<Night[]> {
    this.calls.push({ method: "nights", range });
    this.check();
    return this.allNights.filter((n) => n.wake_date >= range.start && n.wake_date <= range.end);
  }

  async sessions(range: DateRange): Promise<Session[]> {
    this.calls.push({ method: "sessions", range });
    this.check();
    return this.allSessions.filter((s) => s.start.slice(0, 10) >= range.start && s.start.slice(0, 10) <= range.end);
  }

  async dailies(range: DateRange): Promise<Daily[]> {
    this.calls.push({ method: "dailies", range });
    this.check();
    return this.allDailies.filter((d) => d.date >= range.start && d.date <= range.end);
  }

  async sessionDetail(vendorId: string): Promise<SessionDetail | null> {
    this.calls.push({ method: "sessionDetail", id: vendorId });
    this.check();
    return this.details.get(vendorId) ?? null;
  }
}

export function warn(code: Flag["code"], message: string): Flag {
  return { code, severity: "warn", message };
}

/** An in-memory MCP client connected to a server over `adapter`. */
export async function connect(adapter: Adapter, now = NOW) {
  const engine = new Engine({ adapters: [adapter], tz: TZ, now: () => now });
  const server = buildServer(engine);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const first = res.content[0];
      const text = first && first.type === "text" ? first.text : "";
      return { res, text, bytes: Buffer.byteLength(text), json: res.isError ? null : (JSON.parse(text) as any) };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
