import { describe, expect, it } from "vitest";
import { trend } from "../../src/meaning/index.ts";
import { addDays } from "../../src/meaning/time.ts";
import { dailies, night } from "./fixtures.ts";

const AS_OF = "2026-11-05";

describe("trend", () => {
  it("computes 7- and 60-day HRV means, the latest band, and the resting-HR mean excluding today", () => {
    const nights = [];
    for (let i = 59; i >= 0; i--) {
      // Last 7 nights at 50 ms, the 53 before at 60 ms.
      nights.push(night(addDays(AS_OF, -i), { hrv_avg_ms: i < 7 ? 50 : 60 }));
    }
    nights[nights.length - 1] = night(AS_OF, { hrv_avg_ms: 50, hrv_baseline_low_ms: null, hrv_baseline_high_ms: null });
    const t = trend(nights, dailies(AS_OF, 54, 60), AS_OF);
    expect(t.hrv_last_ms).toBe(50);
    expect(t.hrv_7d_mean_ms).toBe(50);
    expect(t.hrv_60d_mean_ms).toBe(round1((7 * 50 + 53 * 60) / 60));
    // Last night has no band: the latest band on or before asOf is used.
    expect([t.hrv_baseline_low_ms, t.hrv_baseline_high_ms]).toEqual([55, 70]);
    expect(t.resting_hr_last_bpm).toBe(60);
    expect(t.resting_hr_30d_mean_bpm).toBe(54);
    expect(t.missing_nights).toEqual([]);
    expect(t.steps.length).toBeGreaterThan(0);
  });

  it("lists missing nights so '5 of the last 7' is honest, and does not substitute last night", () => {
    const nights = [0, 2, 3, 4, 5].map((i) => night(addDays(AS_OF, -i - 1)));
    const t = trend(nights, [], AS_OF);
    expect(t.missing_nights).toEqual(["2026-11-03", "2026-11-05"]);
    expect(t.hrv_last_ms).toBeNull();
    expect(t.steps.find((s) => s.rule === "missing_nights")!.detail).toBe("5 of the last 7 nights are recorded.");
  });
});

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
