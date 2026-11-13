import { describe, expect, it } from "vitest";

import { GarminAdapter } from "../../../src/adapters/garmin/adapter.ts";
import { decodeFit, readFitMsg140, readMsg140 } from "../../../src/adapters/garmin/fit.ts";
import { syntheticFit } from "../../fixtures/garmin/fit-builder.ts";
import { FixtureSource, IST, RUN_START_UTC } from "../../fixtures/garmin/helpers.ts";

const RUN = "1000000001";

function runFit(msg140 = { aerobic10: 34, anaerobic10: 12, recoveryMin: 1500, vo2Raw: Math.round((48 * 65536) / 3.5) }) {
  return syntheticFit({
    startUtcMs: RUN_START_UTC,
    offsetMin: IST,
    sport: 1,
    subSport: 0,
    records: [0, 1, 2, 3].map((i) => ({ s: i * 5, hr: 130 + i, distM: 13 * i, speed: 2.6, altM: 500 + i, cadence: 80 })),
    laps: [{ startS: 0, timerS: 15, distM: 39, hr: 131, maxHr: 133, cadence: 80 }],
    zonesS: [10, 300, 900, 1200, 480, 120, 0],
    zoneBounds: [100, 120, 140, 155, 170, 190],
    msg140,
  });
}

describe("decodeFit", () => {
  it("reads message 140 by number: TE x10, recovery minutes, VO2max x 65536/3.5", () => {
    const fit = decodeFit(runFit());
    expect(fit.errors).toEqual([]);
    expect(fit.offsetMin).toBe(IST);
    expect(fit.msg140).toEqual({ aerobic_te: 3.4, anaerobic_te: 1.2, recovery_min: 1500, vo2max: 48 });
  });

  it("reads records, laps, session and time in zone", () => {
    const fit = decodeFit(runFit());
    expect(fit.records).toHaveLength(4);
    expect(fit.records[1]).toMatchObject({ hr_bpm: 131, speed_mps: 2.6, cadence: 80, elevation_m: 501, distance_m: 13 });
    expect(fit.laps).toHaveLength(1);
    expect(fit.session).toMatchObject({ sport: "running", subSport: "generic", startUtcMs: RUN_START_UTC });
    expect(fit.session!.zone_s).toEqual([10, 300, 900, 1200, 480, 120, 0]);
  });

  it("ignores out-of-scale TE values and missing fields", () => {
    expect(readMsg140({ 4: 255, 20: 7 })).toEqual({ aerobic_te: null, anaerobic_te: 0.7, recovery_min: null, vo2max: null });
    expect(readMsg140(undefined)).toBeNull();
  });

  it("reads msg 140 alone without decoding records, matching the full decode", () => {
    expect(readFitMsg140(runFit())).toEqual(decodeFit(runFit()).msg140);
    expect(readFitMsg140(syntheticFit({ startUtcMs: RUN_START_UTC, offsetMin: IST, sport: 1, subSport: 0, records: [{ s: 0, hr: 120 }] }))).toBeNull();
    expect(readFitMsg140(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("rejects bytes that are not FIT", () => {
    expect(() => decodeFit(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))).toThrow();
  });
});

describe("sessionDetail", () => {
  it("merges the Connect summary with the device file's training effect and recovery", async () => {
    const source = new FixtureSource();
    source.fit.set(`fit/${RUN}`, runFit());
    const detail = (await new GarminAdapter(source, { tz: "Asia/Kolkata" }).sessionDetail(RUN))!;
    expect(detail.session.training_effect).toEqual({ aerobic: 3.4, anaerobic: 1.2, label: "TEMPO", source: "fit" });
    expect(detail.session.recovery).toEqual({ hours: 25, basis: "device" });
    const rules = detail.session.provenance.steps.map((s) => s.rule);
    expect(rules).toEqual(expect.arrayContaining(["te_from_fit_msg140", "recovery_from_fit_msg140"]));
    expect(rules).not.toContain("te_label_only");
    expect(detail.session.provenance.steps.find((s) => s.rule === "te_from_fit_msg140")!.detail).toMatch(/undocumented.*reverse-engineered/);
    expect(detail.session.provenance.source).toBe("garmin:activities + garmin:fit");
    expect(detail.provenance.source).toBe("garmin:fit + garmin:activities + garmin:activity_splits + garmin:hr_zones");
  });

  it("takes laps from splits, zones from hr_zones and samples from the FIT records", async () => {
    const source = new FixtureSource();
    source.fit.set(`fit/${RUN}`, runFit());
    const detail = (await new GarminAdapter(source).sessionDetail(RUN))!;
    expect(detail.laps).toHaveLength(2);
    expect(detail.laps[0]).toEqual({
      index: 1, distance_km: 4, duration_min: 25, moving_min: 24.8, avg_hr_bpm: 140, max_hr_bpm: 158,
      avg_cadence_spm: 160.5, stride_cm: 98.4, elevation_gain_m: 20, elevation_loss_m: 18.5,
    });
    expect(detail.zones).toEqual([
      { zone: 1, low_bpm: 100, minutes: 5 }, { zone: 2, low_bpm: 120, minutes: 15 },
      { zone: 3, low_bpm: 140, minutes: 20 }, { zone: 4, low_bpm: 155, minutes: 8 },
      { zone: 5, low_bpm: 170, minutes: 2 },
    ]);
    expect(detail.session.hard_min).toBe(10);
    expect(detail.samples[1]).toEqual({
      t: "2026-03-02T07:00:05+05:30", elapsed_s: 5, hr_bpm: 131, speed_mps: 2.6,
      cadence_spm: 160, elevation_m: 501, distance_m: 13,
    });
    expect(JSON.stringify(detail)).not.toMatch(/lat|long|position/i);
    expect(detail.flags).toEqual([]);
  });

  it("caps recovery at the watch's 96 h and says so", async () => {
    const source = new FixtureSource();
    source.fit.set(`fit/${RUN}`, runFit({ aerobic10: 40, anaerobic10: 0, recoveryMin: 6000, vo2Raw: 0 }));
    const detail = (await new GarminAdapter(source).sessionDetail(RUN))!;
    expect(detail.session.recovery).toEqual({ hours: 96, basis: "device" });
    expect(detail.session.provenance.steps.find((s) => s.rule === "recovery_from_fit_msg140")!.detail).toMatch(/96 h cap/);
  });

  it("falls back to Connect chart data for samples when there is no device file", async () => {
    const detail = (await new GarminAdapter(new FixtureSource()).sessionDetail(RUN))!;
    expect(detail.session.training_effect!.source).toBe("label_only");
    expect(detail.samples).toHaveLength(3);
    expect(detail.samples[2]).toEqual({
      t: "2026-03-02T07:00:10+05:30", elapsed_s: 10, hr_bpm: 132, speed_mps: 2.6,
      cadence_spm: 160, elevation_m: 502, distance_m: 26,
    });
    expect(detail.provenance.source).toContain("garmin:activity_details");
  });

  it("builds the session from the FIT file alone when no Connect summary was recorded", async () => {
    const source = new FixtureSource();
    const id = "2000000009";
    source.fit.set(`fit/${id}`, syntheticFit({
      startUtcMs: Date.parse("2026-03-05T12:00:00Z"), offsetMin: IST, sport: 10, subSport: 20,
      records: [0, 10, 20].map((s) => ({ s, hr: 100 + s })),
      zonesS: [60, 0, 0, 0, 0, 0, 0], zoneBounds: [100, 120, 140, 155, 170, 190],
      msg140: { aerobic10: 21, anaerobic10: 18, recoveryMin: 300 },
    }));
    const detail = (await new GarminAdapter(source).sessionDetail(id))!;
    expect(detail.session).toMatchObject({
      id, type: "strength", vendor_type: "strength_training",
      start: "2026-03-05T17:30:00+05:30", tz: "+05:30", distance_km: null,
      training_effect: { aerobic: 2.1, anaerobic: 1.8, label: null, source: "fit" },
      recovery: { hours: 5, basis: "device" },
    });
    expect(detail.session.flags.map((f) => f.code)).toEqual(["partial"]);
    expect(detail.samples.every((s) => s.cadence_spm === null)).toBe(true);
    expect(detail.flags.map((f) => f.message).join()).toMatch(/no laps/);
  });

  it("returns null for an unknown or malformed id", async () => {
    const adapter = new GarminAdapter(new FixtureSource());
    expect(await adapter.sessionDetail("999")).toBeNull();
    expect(await adapter.sessionDetail("../sleep/2026-03-02")).toBeNull();
  });
});
