import { describe, expect, it } from "vitest";

import { GarminAdapter } from "../../../src/adapters/garmin/adapter.ts";
import { sessionType, stripMessageId } from "../../../src/adapters/garmin/map.ts";
import type { RawSource } from "../../../src/adapter.ts";
import { syntheticFit } from "../../fixtures/garmin/fit-builder.ts";
import { FixtureSource, IST, RUN_START_UTC } from "../../fixtures/garmin/helpers.ts";

const adapter = new GarminAdapter(new FixtureSource(), { tz: "Asia/Kolkata" });
const range = { start: "2026-03-01", end: "2026-03-05" };

describe("sessions", () => {
  it("returns every activity in the range, sorted by start", async () => {
    const sessions = await adapter.sessions(range);
    expect(sessions.map((s) => s.id)).toEqual(["1000000001", "1000000002", "1000000004", "1000000003"]);
  });

  it("maps a run: units, local times, hard minutes, label-only training effect", async () => {
    const [run] = await adapter.sessions({ start: "2026-03-02", end: "2026-03-02" });
    expect(run).toMatchObject({
      id: "1000000001", parts: ["1000000001"], type: "running", vendor_type: "running",
      start: "2026-03-02T07:00:00+05:30", end: "2026-03-02T07:52:00+05:30", tz: "Asia/Kolkata",
      duration_min: 50, elapsed_min: 52, distance_km: 8, avg_hr_bpm: 148, max_hr_bpm: 170,
      hard_min: 10, calories_kcal: 520, elevation_gain_m: 40.3, avg_cadence_spm: 162.4,
      training_effect: { aerobic: null, anaerobic: null, label: "TEMPO", source: "label_only" },
      recovery: null, energy_impact: -14, flags: [],
    });
    const detail = run!.provenance.steps.find((s) => s.rule === "te_message_id_stripped")!.detail;
    expect(detail).toContain("IMPROVING_VO2_MAX,");
    expect(detail).not.toContain("_13");
  });

  it("gives strength no distance and keeps the vendor type", async () => {
    const sessions = await adapter.sessions({ start: "2026-03-02", end: "2026-03-02" });
    const strength = sessions[1]!;
    expect(strength).toMatchObject({ type: "strength", vendor_type: "strength_training", distance_km: null, hard_min: 1 });
  });

  it("uses numeric training effect and recovery when the API sends them", async () => {
    const sessions = await adapter.sessions({ start: "2026-03-03", end: "2026-03-03" });
    const cardio = sessions.find((s) => s.id === "1000000004")!;
    expect(cardio.type).toBe("cardio");
    expect(cardio.training_effect).toEqual({ aerobic: 2.8, anaerobic: 1.1, label: "AEROBIC_BASE", source: "api" });
    expect(cardio.recovery).toEqual({ hours: 12, basis: "device" });
  });

  it("flags a manual entry without heart rate", async () => {
    const sessions = await adapter.sessions({ start: "2026-03-03", end: "2026-03-03" });
    const manual = sessions.find((s) => s.id === "1000000003")!;
    expect(manual.type).toBe("other");
    expect(manual.vendor_type).toBe("badminton");
    expect(manual.flags.map((f) => f.code)).toEqual(["user_reported", "partial"]);
  });

  it.each([
    ["indoor_cardio", "cardio"], ["strength_training", "strength"], ["treadmill_running", "running"],
    ["road_biking", "cycling"], ["lap_swimming", "swimming"], ["hiking", "walking"],
    ["ultra_run", "running"], ["badminton", "other"],
  ])("type %s -> %s", (key, type) => {
    expect(sessionType(key)).toBe(type);
  });

  it.each([
    ["IMPROVING_VO2_MAX_13", "IMPROVING_VO2_MAX"],
    ["NO_ANAEROBIC_BENEFIT_0", "NO_ANAEROBIC_BENEFIT"],
    ["TEMPO", "TEMPO"],
    [null, null],
  ])("strips the message id from %s", (raw, out) => {
    expect(stripMessageId(raw)).toBe(out);
  });

  describe("enriched from the device file", () => {
    const fit = () => syntheticFit({
      startUtcMs: RUN_START_UTC, offsetMin: IST, sport: 1, subSport: 0,
      records: [0, 5, 10].map((s) => ({ s, hr: 140 })),
      msg140: { aerobic10: 36, anaerobic10: 9, recoveryMin: 1980 },
    });

    it("gets numeric TE and device recovery from msg 140 when the FIT is present", async () => {
      const source = new FixtureSource();
      source.fit.set("fit/1000000001", fit());
      const [run, strength] = await new GarminAdapter(source).sessions({ start: "2026-03-02", end: "2026-03-02" });
      expect(run!.training_effect).toEqual({ aerobic: 3.6, anaerobic: 0.9, label: "TEMPO", source: "fit" });
      expect(run!.recovery).toEqual({ hours: 33, basis: "device" });
      const rules = run!.provenance.steps.map((s) => s.rule);
      expect(rules).toEqual(expect.arrayContaining(["te_from_fit_msg140", "recovery_from_fit_msg140"]));
      expect(rules).not.toContain("te_label_only");
      expect(run!.provenance.source).toBe("garmin:activities + garmin:fit");
      // No FIT for the strength session: unchanged.
      expect(strength!.training_effect!.source).toBe("label_only");
      expect(strength!.recovery).toBeNull();
    });

    it("stays label_only with no recovery when there is no FIT", async () => {
      const [run] = await adapter.sessions({ start: "2026-03-02", end: "2026-03-02" });
      expect(run!.training_effect!.source).toBe("label_only");
      expect(run!.recovery).toBeNull();
    });

    it("reads each FIT at most once per adapter, and only for sessions in range", async () => {
      const inner = new FixtureSource();
      inner.fit.set("fit/1000000001", fit());
      const asked: string[] = [];
      const counting: RawSource = {
        json: (k) => inner.json(k),
        bytes: (k) => { asked.push(k); return inner.bytes(k); },
      };
      const a = new GarminAdapter(counting);
      await a.sessions({ start: "2026-03-02", end: "2026-03-02" });
      const again = await a.sessions({ start: "2026-03-02", end: "2026-03-02" });
      expect(again[0]!.recovery).toEqual({ hours: 33, basis: "device" });
      expect(asked.sort()).toEqual(["fit/1000000001", "fit/1000000002"]);
    });

    it("ignores a corrupt FIT", async () => {
      const source = new FixtureSource();
      source.fit.set("fit/1000000001", new Uint8Array([14, 16, 0, 0, 9, 0, 0, 0, 46, 70, 73, 84, 0, 0, 1, 2]));
      const [run] = await new GarminAdapter(source).sessions({ start: "2026-03-02", end: "2026-03-02" });
      expect(run!.training_effect!.source).toBe("label_only");
    });
  });
});
