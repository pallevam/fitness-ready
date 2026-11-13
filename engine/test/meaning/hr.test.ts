import { describe, expect, it } from "vitest";
import { detectHrSpikes } from "../../src/meaning/index.ts";
import { hrSeries, jitter } from "./fixtures.ts";

describe("detectHrSpikes", () => {
  it("regression 1 Nov: flags the 181 bpm spike during indoor cardio", () => {
    // ~40 s steady near 147, then 147 -> 164 -> 177 -> 181 within 3 s,
    // back to ~163 within ~10 s, then steady near 163.
    const before = Array.from({ length: 40 }, (_, i) => 147 + jitter(i, 2));
    const spike = [164, 177, 181, 176, 172, 169, 167, 165, 164, 163, 163];
    const after = Array.from({ length: 60 }, (_, i) => 163 + jitter(i + 100, 2));
    const flags = detectHrSpikes(hrSeries([...before.slice(0, -1), 147, ...spike, ...after]));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.code).toBe("sensor_spike");
    expect(flags[0]!.severity).toBe("warn");
    expect(flags[0]!.message).toContain("181");
    expect(flags[0]!.message).toContain("18:00"); // the spike's local time
    expect(flags[0]!.message).toMatch(/bpm\/s/);
  });

  it("does not flag a gradual climb from 113 to 142 bpm over an 8 km run", () => {
    // ~45 min at 1 sample / 2 s, climbing slowly with +-2 bpm noise.
    const n = 1350;
    const hrs = Array.from({ length: n }, (_, i) => Math.round(113 + (29 * i) / n) + jitter(i, 2));
    expect(detectHrSpikes(hrSeries(hrs, undefined, 2))).toEqual([]);
  });

  it("does not flag a steady 165-183 bpm race effort, including a hill surge", () => {
    const hrs = Array.from({ length: 2400 }, (_, i) => {
      const drift = 165 + (14 * i) / 2400; // slow cardiac drift
      const surge = i >= 1200 && i < 1260 ? ((i - 1200) / 60) * 6 : 0; // +6 bpm over a minute
      return Math.min(183, Math.max(165, Math.round(drift + surge) + jitter(i, 2)));
    });
    expect(detectHrSpikes(hrSeries(hrs))).toEqual([]);
  });

  it("flags a brief isolated peak even when sparse sampling hides the rise rate", () => {
    // Samples every 5 s: one jump of 52 bpm is a single interval, so the
    // fast-rise rule needs two; the 60 s median rule catches it.
    const hrs = Array.from({ length: 40 }, (_, i) => (i === 20 ? 172 : 120 + jitter(i, 2)));
    const flags = detectHrSpikes(hrSeries(hrs, undefined, 5));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.message).toContain("172");
    expect(flags[0]!.message).toMatch(/above the median/);
  });

  it("does not flag a sustained high plateau that lasts beyond 15 s", () => {
    // An interval rep: 120 -> 165 over 20 s, held 90 s.
    const hrs = [
      ...Array.from({ length: 60 }, () => 120),
      ...Array.from({ length: 20 }, (_, i) => 120 + Math.round((45 * (i + 1)) / 20)),
      ...Array.from({ length: 90 }, () => 165),
    ];
    expect(detectHrSpikes(hrSeries(hrs))).toEqual([]);
  });

  it("ignores missing HR and returns nothing for too few samples", () => {
    expect(detectHrSpikes([])).toEqual([]);
    const s = hrSeries([120, 180]);
    expect(detectHrSpikes(s)).toEqual([]);
    const withNulls = hrSeries(Array.from({ length: 30 }, () => 130)).map((x, i) =>
      i % 3 === 0 ? { ...x, hr_bpm: null } : x,
    );
    expect(detectHrSpikes(withNulls)).toEqual([]);
  });
});
