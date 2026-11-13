import { afterEach, describe, expect, it } from "vitest";
import { addDays } from "../../src/mcp/format.ts";
import { FakeAdapter, NOW, TODAY, connect, meaningReady, warn } from "./fixtures.ts";

type Conn = Awaited<ReturnType<typeof connect>>;
let conn: Conn | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

const TOOLS = ["get_brief", "get_readiness", "get_nights", "get_sessions", "get_session_detail"];

function expectEnvelope(json: any) {
  expect(Object.keys(json).sort()).toEqual(["as_of", "data", "flags", "how_built"]);
  expect(Array.isArray(json.flags)).toBe(true);
  expect(Array.isArray(json.how_built)).toBe(true);
  for (const s of json.how_built) expect(Object.keys(s).sort()).toEqual(["detail", "rule"]);
}

/** No null anywhere in a payload: nulls are omitted, not sent. */
function expectNoNulls(v: unknown, path = "$"): void {
  expect(v, path).not.toBeNull();
  if (Array.isArray(v)) v.forEach((x, i) => expectNoNulls(x, `${path}[${i}]`));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) expectNoNulls(x, `${path}.${k}`);
}

// ------------------------------------------------- needs no meaning bodies

describe("tool surface", () => {
  it("lists the five read-only tools with LLM-facing guidance", async () => {
    conn = await connect(new FakeAdapter());
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const t of tools) {
      expect(t.description).toMatch(/cite numbers with their dates/i);
      expect(t.description).toMatch(/never diagnose/i);
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.outputSchema?.properties).toHaveProperty("how_built");
    }
    expect(conn.client.getInstructions()).toMatch(/clinician/);
  });

  it("caps get_nights at 31 days and explains how to proceed", async () => {
    conn = await connect(new FakeAdapter());
    const over = await conn.call("get_nights", { start: "2026-10-01", end: "2026-11-01" });
    expect(over.res.isError).toBe(true);
    expect(over.text).toMatch(/32 days.*limit is 31.*Split/);
    const ok = await conn.call("get_nights", { start: "2026-10-01", end: "2026-10-31" });
    expect(ok.res.isError).toBeFalsy();
    expectEnvelope(ok.json);
    expect(ok.json.data.count).toBe(31);
  });

  it("rejects bad ranges and dates without touching the adapter", async () => {
    const fake = new FakeAdapter();
    conn = await connect(fake);
    expect((await conn.call("get_nights", { start: "2026-11-05", end: "2026-11-01" })).text).toMatch(/after end/);
    expect((await conn.call("get_nights", { start: "2026-02-30", end: "2026-03-01" })).text).toMatch(/not a YYYY-MM-DD/);
    expect((await conn.call("get_nights", { start: "5 Nov", end: "2026-11-01" })).res.isError).toBe(true);
    expect((await conn.call("get_brief", { date: addDays(TODAY, 1) })).text).toMatch(/in the future/);
    expect(fake.calls).toEqual([]);
  });

  it("get_nights: full nights, missing dates listed, flags lifted with their record, nulls omitted", async () => {
    const gap = addDays(TODAY, -3);
    const odd = addDays(TODAY, -2);
    const fake = new FakeAdapter({
      dropNights: [gap],
      nightOverrides: {
        [odd]: { validation: "off_wrist", respiration_brpm: null, flags: [warn("off_wrist", "Watch was off the wrist.")] },
      },
    });
    conn = await connect(fake);
    const r = await conn.call("get_nights", { start: addDays(TODAY, -6), end: TODAY });
    expectEnvelope(r.json);
    expectNoNulls(r.json);
    expect(r.json.data.missing_nights).toEqual([gap]);
    expect(r.json.data.count).toBe(6);
    const n = r.json.data.nights.find((x: any) => x.wake_date === odd);
    expect(n).not.toHaveProperty("respiration_brpm");
    expect(n.score).toBe("78 (0-100, GOOD)");
    expect(n.hrv_baseline_ms).toBe("52-68");
    expect(r.json.flags).toContainEqual({ code: "off_wrist", severity: "warn", message: "Watch was off the wrist.", on: `night ${odd}` });
    // Rounded: 58.37 ms -> whole ms, 14.23 brpm -> one decimal.
    expect(Number.isInteger(r.json.data.nights[0].hrv_avg_ms)).toBe(true);
    expect(r.json.data.nights[0].respiration_brpm).toBe(14.2);
    // Provenance said once per rule, not once per night.
    expect(r.json.how_built.filter((s: any) => s.rule === "wake_day_dating")).toHaveLength(1);
    expect(r.json.how_built[0].detail).toMatch(/Read 6 of 7 nights/);
  });

  it("caps get_sessions at 92 days", async () => {
    conn = await connect(new FakeAdapter());
    const over = await conn.call("get_sessions", { start: addDays(TODAY, -92), end: TODAY });
    expect(over.res.isError).toBe(true);
    expect(over.text).toMatch(/93 days.*limit is 92/);
  });

  it("an adapter failure is a tool error that leaks nothing", async () => {
    conn = await connect(new FakeAdapter({ fail: true }));
    const r = await conn.call("get_nights", { start: TODAY, end: TODAY });
    expect(r.res.isError).toBe(true);
    expect(r.text).not.toMatch(/abc123|body|503/);
    expect(r.text).toMatch(/could not be read/);
  });

  it("get_session_detail: unknown id is a clear error", async () => {
    conn = await connect(new FakeAdapter());
    const r = await conn.call("get_session_detail", { session_id: "nope" });
    expect(r.res.isError).toBe(true);
    expect(r.text).toMatch(/No session with id nope.*get_sessions/);
  });
});

// ------------------------------------------- needs the meaning layer bodies

describe.skipIf(!meaningReady)("with the meaning layer (skipped only if meaning/ bodies throw)", () => {
  it("get_brief: envelope, windows fetched, merged sessions, readiness and recovery", async () => {
    const fake = new FakeAdapter();
    conn = await connect(fake);
    const r = await conn.call("get_brief");
    expectEnvelope(r.json);
    expectNoNulls(r.json);
    expect(r.res.structuredContent).toEqual(r.json);
    expect(r.json.as_of).toBe(NOW);

    // Fetches only the windows readiness needs.
    const ranges = Object.fromEntries(fake.calls.map((c) => [c.method, c.range]));
    expect(ranges.nights).toEqual({ start: addDays(TODAY, -59), end: TODAY });
    expect(ranges.dailies).toEqual({ start: addDays(TODAY, -30), end: TODAY });
    expect(ranges.sessions).toEqual({ start: addDays(TODAY, -7), end: TODAY });
    expect(fake.calls.some((c) => c.method === "sessionDetail")).toBe(false);

    const d = r.json.data;
    expect(d.date).toBe(TODAY);
    expect(d.last_night_status).toBe("synced");
    expect(d.last_night.wake_date).toBe(TODAY);
    expect(d.last_night.label).toBe(`night of ${addDays(TODAY, -1)} into ${TODAY}`);
    expect(d.trend_7n.nights).toHaveLength(7);
    expect(d.trend_7n.hrv_baseline_ms).toBe("52-68");
    expect(d.trend_7n).not.toHaveProperty("missing_nights");

    // The two-part run is one session; three sessions this week, one hard.
    expect(d.sessions_7d.count).toBe(3);
    expect(d.sessions_7d.hard_count).toBe(1);
    const run = d.sessions_7d.items.find((s: any) => s.id === "run-a");
    expect(run.parts).toBe(2);
    expect(run.duration_min).toBe(47);
    expect(d.sessions_7d.items.some((s: any) => s.id === "run-b")).toBe(false);
    expect(r.json.flags.some((f: any) => f.code === "merged_parts" && f.on === "session run-a")).toBe(true);

    expect(["green", "amber", "red", "insufficient_data"]).toContain(d.readiness.colour);
    expect(d.readiness.checks).toHaveLength(4);
    // Yesterday's hard run: 36 h device recovery from its 06:50 end -> ~11.3 h left at 07:30.
    expect(d.recovery.last_hard.id).toBe("run-hard");
    expect(d.recovery.basis).toBe("device");
    expect(d.recovery.remaining_h).toBeCloseTo(11.3, 0);
    expect(d.readiness.failed).toContain("recovery");
    expect(r.json.how_built.some((s: any) => s.rule === "fetch_sessions")).toBe(true);
  });

  it("get_brief: last night missing -> not_synced, flagged once, no earlier night substituted", async () => {
    conn = await connect(new FakeAdapter({ dropNights: [TODAY] }));
    const r = await conn.call("get_brief");
    const d = r.json.data;
    expect(d.last_night_status).toBe("not_synced");
    expect(d).not.toHaveProperty("last_night");
    expect(d.trend_7n.missing_nights).toEqual([TODAY]);
    expect(d.trend_7n).not.toHaveProperty("hrv_last_ms");
    const ns = r.json.flags.filter((f: any) => f.code === "not_synced");
    expect(ns).toHaveLength(1);
    expect(ns[0].severity).toBe("warn");
    expect(ns[0].message).toContain(TODAY);
    expect(d.readiness.missing).toContain("sleep");
  });

  it("get_brief: propagates record flags from the week's nights and sessions", async () => {
    const odd = addDays(TODAY, -4);
    const fake = new FakeAdapter({ nightOverrides: { [odd]: { validation: "imputed", flags: [warn("imputed", "Some stages were filled from averages.")] } } });
    conn = await connect(fake);
    const r = await conn.call("get_brief");
    expect(r.json.flags).toContainEqual({ code: "imputed", severity: "warn", message: "Some stages were filled from averages.", on: `night ${odd}` });
    expect(r.json.data.trend_7n.nights.find((n: any) => n.wake_date === odd).validation).toBe("imputed");
  });

  it("get_brief stays under 8 KB with 60 nights and three sessions a day", async () => {
    conn = await connect(new FakeAdapter({ extraSessionsPerDay: 3 }));
    const r = await conn.call("get_brief");
    expect(r.json.data.sessions_7d.count).toBeGreaterThan(20);
    expect(r.json.data.sessions_7d.items.length).toBeLessThanOrEqual(14);
    expect(r.json.data.sessions_7d.omitted).toBe(r.json.data.sessions_7d.count - 14);
    console.info(`get_brief payload: ${r.bytes} bytes (busy week)`);
    expect(r.bytes).toBeLessThan(8 * 1024);
    const quiet = await (await connect(new FakeAdapter())).call("get_brief");
    console.info(`get_brief payload: ${quiet.bytes} bytes (typical week)`);
    expect(quiet.bytes).toBeLessThan(6 * 1024);
  });

  it("get_brief for a past date judges as of the end of that day", async () => {
    conn = await connect(new FakeAdapter());
    const day = addDays(TODAY, -10);
    const r = await conn.call("get_brief", { date: day });
    expect(r.json.data.date).toBe(day);
    expect(r.json.as_of).toBe(`${addDays(day, 1)}T00:00:00+05:30`);
    expect(r.json.how_built.some((s: any) => s.rule === "historical_as_of")).toBe(true);
  });

  it("get_readiness: verdict, checks and recovery in the envelope", async () => {
    conn = await connect(new FakeAdapter());
    const r = await conn.call("get_readiness");
    expectEnvelope(r.json);
    expect(r.json.data.colour).toBe("amber");
    expect(r.json.data.failed).toEqual(["recovery"]);
    expect(r.json.data.based_on).toMatch(/4 of 4/);
    expect(r.json.data.recovery.last_hard.id).toBe("run-hard");
    expect(r.bytes).toBeLessThan(4 * 1024);
  });

  it("get_sessions: merged, totals per type, type filter, cross-midnight lookahead", async () => {
    const fake = new FakeAdapter();
    conn = await connect(fake);
    const r = await conn.call("get_sessions", { start: addDays(TODAY, -7), end: TODAY });
    expectEnvelope(r.json);
    expectNoNulls(r.json);
    expect(fake.calls.find((c) => c.method === "sessions")?.range?.end).toBe(addDays(TODAY, 1));
    const t = r.json.data.totals;
    expect(t.count).toBe(3);
    expect(t.hard_count).toBe(1);
    expect(t.by_type.running.count).toBe(2);
    expect(t.by_type.running.duration_min).toBe(97);
    expect(t.by_type.strength).toEqual({ count: 1, duration_min: 40 });
    const gym = r.json.data.sessions.find((s: any) => s.id === "gym-1");
    expect(gym).not.toHaveProperty("distance_km");
    expect(gym.hard).toBe(false);

    const runs = await conn.call("get_sessions", { start: addDays(TODAY, -7), end: TODAY, type: "strength" });
    expect(runs.json.data.sessions.map((s: any) => s.id)).toEqual(["gym-1"]);
    expect(runs.json.data.type).toBe("strength");

    const bad = await conn.call("get_sessions", { start: TODAY, end: TODAY, type: "yoga" });
    expect(bad.res.isError).toBe(true);
  });

  it("get_sessions: 92 days is allowed", async () => {
    conn = await connect(new FakeAdapter({ extraSessionsPerDay: 1 }));
    const r = await conn.call("get_sessions", { start: addDays(TODAY, -91), end: TODAY });
    expect(r.res.isError).toBeFalsy();
    console.info(`get_sessions payload: ${r.bytes} bytes for ${r.json.data.totals.count} sessions over 92 days`);
  });

  it("get_session_detail: laps, zones, device TE/recovery, spike flag; samples omitted by default", async () => {
    conn = await connect(new FakeAdapter());
    const r = await conn.call("get_session_detail", { session_id: "run-hard" });
    expectEnvelope(r.json);
    expectNoNulls(r.json);
    const d = r.json.data;
    expect(d).not.toHaveProperty("samples");
    expect(d.samples_available).toBe(3000);
    expect(d.laps).toHaveLength(2);
    expect(d.laps[1]).toEqual({ index: 2, distance_km: 1, duration_min: 5.9, moving_min: 5.8, avg_hr_bpm: 146, max_hr_bpm: 155, avg_cadence_spm: 170, stride_cm: 100 });
    expect(d.zones.map((z: any) => z.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(d.session.training_effect).toEqual({ aerobic: 3.6, anaerobic: 1.2, label: "TEMPO", source: "api" });
    expect(d.session.recovery).toEqual({ hours: 36, basis: "device" });
    expect(d.session.hard).toBe(true);
    const spikes = r.json.flags.filter((f: any) => f.code === "sensor_spike");
    expect(spikes.length).toBeGreaterThan(0);
    expect(spikes[0].on).toBe("session run-hard");
    expect(spikes[0].message).toMatch(/186/);
    console.info(`get_session_detail payload: ${r.bytes} bytes without samples`);
    expect(r.bytes).toBeLessThan(4 * 1024);
  });

  it("get_session_detail: include_samples downsamples to at most 300 columnar points", async () => {
    conn = await connect(new FakeAdapter());
    const r = await conn.call("get_session_detail", { session_id: "run-hard", include_samples: true });
    const s = r.json.data.samples;
    expect(s.of).toBe(3000);
    expect(s.points).toBeLessThanOrEqual(300);
    expect(s.every).toBe(10);
    expect(s.columns).toEqual(["elapsed_s", "hr_bpm", "speed_mps", "cadence_spm", "distance_m"]);
    expect(s.rows[1]).toEqual([10, 121, 2.8, 168, 28]);
    expect(r.json.how_built.some((x: any) => x.rule === "downsample")).toBe(true);
    console.info(`get_session_detail payload: ${r.bytes} bytes with samples`);
    expect(r.bytes).toBeLessThan(16 * 1024);
  });

  it("get_session_detail: a split run returns both parts on one clock, by either part's id", async () => {
    conn = await connect(new FakeAdapter());
    for (const id of ["run-a", "run-b"]) {
      const r = await conn.call("get_session_detail", { session_id: id, include_samples: true });
      const d = r.json.data;
      expect(d.session.id).toBe("run-a");
      expect(d.session.parts).toEqual(["run-a", "run-b"]);
      expect(d.laps.map((l: any) => l.index)).toEqual([1, 2, 3, 4]);
      expect(d.zones.find((z: any) => z.zone === 2).minutes).toBe(21);
      expect(d.samples_available).toBe(30 * 60 + 17 * 60);
      // Second part starts 33 min after the first: its samples sit at >= 1980 s.
      const last = d.samples.rows.at(-1)[0];
      expect(last).toBeGreaterThan(33 * 60);
      // No spike invented across the gap between parts.
      expect(r.json.flags.some((f: any) => f.code === "sensor_spike")).toBe(false);
    }
  });
});
