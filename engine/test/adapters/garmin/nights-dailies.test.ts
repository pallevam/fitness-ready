import { describe, expect, it } from "vitest";

import { GarminAdapter } from "../../../src/adapters/garmin/adapter.ts";
import { mapNight, sleepValidation } from "../../../src/adapters/garmin/map.ts";
import { FixtureSource } from "../../fixtures/garmin/helpers.ts";

const adapter = new GarminAdapter(new FixtureSource(), { tz: "Asia/Kolkata" });
const range = { start: "2026-03-01", end: "2026-03-05" };

describe("nights", () => {
  it("dates a night by the wake day and converts seconds to minutes", async () => {
    const nights = await adapter.nights(range);
    const night = nights.find((n) => n.wake_date === "2026-03-02")!;
    expect(night.label).toBe("night of 2026-03-01 into 2026-03-02");
    expect(night.start).toBe("2026-03-01T23:40:00+05:30");
    expect(night.end).toBe("2026-03-02T06:40:00+05:30");
    expect(night.tz).toBe("Asia/Kolkata");
    expect(night).toMatchObject({
      asleep_min: 400, deep_min: 90, light_min: 220, rem_min: 90, awake_min: 20,
      score: { value: 81, min: 0, max: 100, label: "GOOD" },
      resting_hr_bpm: 50, respiration_brpm: 14, validation: "device",
    });
    expect(night.flags).toEqual([]);
    expect(night.provenance.vendor).toBe("garmin");
    expect(night.provenance.source).toBe("garmin:sleep+hrv");
    expect(night.provenance.steps.map((s) => s.rule)).toEqual(
      expect.arrayContaining(["wake_day_dating", "seconds_to_minutes", "tz_from_local_gmt"]),
    );
  });

  it("takes HRV and the balanced baseline band from the hrv summary", async () => {
    const [night] = await adapter.nights({ start: "2026-03-02", end: "2026-03-02" });
    expect(night!.hrv_avg_ms).toBe(63); // hrvSummary.lastNightAvg, not sleep's avgOvernightHrv
    expect(night!.hrv_baseline_low_ms).toBe(54); // balancedLow, not lowUpper
    expect(night!.hrv_baseline_high_ms).toBe(70);
  });

  it("leaves an unworn (all-null) night out rather than returning an empty record", async () => {
    const nights = await adapter.nights(range);
    expect(nights.map((n) => n.wake_date)).toEqual(["2026-03-02", "2026-03-04"]);
  });

  it("marks a hand-confirmed night as user_reported and flags missing score and HRV", async () => {
    const [night] = await adapter.nights({ start: "2026-03-04", end: "2026-03-04" });
    expect(night!.validation).toBe("user_reported");
    expect(night!.flags.map((f) => f.code)).toEqual(["user_reported", "partial"]);
    expect(night!.flags[1]!.message).toMatch(/sleep score, HRV/);
    expect(night!.score).toBeNull();
    expect(night!.hrv_avg_ms).toBeNull();
    expect(night!.provenance.source).toBe("garmin:sleep");
  });

  it("reports the bare offset when the configured zone does not match (travel)", () => {
    const start = Date.parse("2026-03-02T04:00:00Z");
    const end = Date.parse("2026-03-02T11:00:00Z");
    const off = -5 * 3600_000;
    const night = mapNight({ dailySleepDTO: {
      calendarDate: "2026-03-02", sleepTimeSeconds: 25200,
      sleepStartTimestampGMT: start, sleepEndTimestampGMT: end,
      sleepStartTimestampLocal: start + off, sleepEndTimestampLocal: end + off,
    } }, null, "2026-03-02", { tz: "Asia/Kolkata" });
    expect(night!.tz).toBe("-05:00");
    expect(night!.start).toBe("2026-03-01T23:00:00-05:00");
  });

  it.each([
    ["enhanced_confirmed_final", "device", []],
    ["AUTO_CONFIRMED_TENTATIVE", "device", []],
    ["off_wrist", "off_wrist", ["off_wrist"]],
    ["MANUALLY_CORRECTED", "user_reported", ["user_reported"]],
    [null, "device", []],
  ])("validation %s -> %s", (raw, validation, codes) => {
    const v = sleepValidation(raw);
    expect(v.validation).toBe(validation);
    expect(v.flags.map((f) => f.code)).toEqual(codes);
  });

  it("notes a tentative night in provenance", () => {
    const t = Date.parse("2026-03-02T00:00:00Z");
    const night = mapNight({ dailySleepDTO: {
      calendarDate: "2026-03-02", sleepTimeSeconds: 3600, sleepWindowConfirmationType: "enhanced_confirmed_tentative",
      sleepStartTimestampGMT: t, sleepEndTimestampGMT: t + 3600_000,
      sleepStartTimestampLocal: t, sleepEndTimestampLocal: t + 3600_000,
    } }, null, "2026-03-02");
    expect(night!.tz).toBe("+00:00");
    expect(night!.provenance.steps.map((s) => s.rule)).toContain("tentative_night");
  });
});

describe("dailies", () => {
  it("maps a full day, with intensity minutes = moderate + 2 x vigorous", async () => {
    const [day] = await adapter.dailies({ start: "2026-03-02", end: "2026-03-02" });
    expect(day).toMatchObject({
      date: "2026-03-02", resting_hr_bpm: 51, steps: 8400,
      stress_avg: { value: 32, min: 0, max: 100, label: "BALANCED" },
      energy_high: 88, energy_low: 20, intensity_min: 35,
    });
    expect(day!.flags).toEqual([]);
    expect(day!.provenance.source).toBe("garmin:daily_summary");
  });

  it("treats negative stress as unmeasured and flags a day still in progress", async () => {
    const [day] = await adapter.dailies({ start: "2026-03-03", end: "2026-03-03" });
    expect(day!.stress_avg).toBeNull();
    expect(day!.provenance.steps.map((s) => s.rule)).toContain("stress_unmeasured");
    expect(day!.flags.map((f) => f.code)).toEqual(["partial", "partial"]);
    expect(day!.flags[0]!.message).toMatch(/in progress.*10:00/);
    expect(day!.flags[1]!.message).toMatch(/stress/);
  });

  it("returns nothing for a day with no measurements", async () => {
    const days = await adapter.dailies(range);
    expect(days.map((d) => d.date)).toEqual(["2026-03-02", "2026-03-03"]);
  });
});
