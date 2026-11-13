import { describe, expect, it } from "vitest";
import { isHardSession, hardSessionReasons, mergeSplitSessions } from "../../src/meaning/index.ts";
import { at, session } from "./fixtures.ts";

describe("mergeSplitSessions", () => {
  it("regression 15 Sep: a run saved as 3.36 km + 9.01 km, 1.3 min apart, is one 12.37 km session", () => {
    // Timer end of part 1: 19:10:43 + 31.9 min = 19:42:37; part 2 starts 19:43:55 (1.3 min later).
    const first = session({
      id: "a1", start: at("2026-09-15", "19:10:43"), duration_min: 31.9,
      distance_km: 3.36, avg_hr_bpm: 117, max_hr_bpm: 137, calories_kcal: 100, hard_min: 0,
    });
    const second = session({
      id: "a2", start: at("2026-09-15", "19:43:55"), duration_min: 75,
      distance_km: 9.01, avg_hr_bpm: 164, max_hr_bpm: 184, calories_kcal: 300, hard_min: 30,
    });
    const merged = mergeSplitSessions([first, second]);
    expect(merged).toHaveLength(1);
    const run = merged[0]!;
    expect(run.id).toBe("a1");
    expect(run.parts).toEqual(["a1", "a2"]);
    expect(run.distance_km).toBe(12.37);
    expect(run.duration_min).toBe(106.9);
    expect(run.avg_hr_bpm).toBe(Math.round((117 * 31.9 + 164 * 75) / 106.9));
    expect(run.max_hr_bpm).toBe(184);
    expect(run.calories_kcal).toBe(400);
    expect(run.hard_min).toBe(30);
    expect(run.start).toBe(first.start);
    expect(run.end).toBe(second.end);
    expect(run.elapsed_min).toBeCloseTo(108.2, 1);
    expect(run.flags.map((f) => f.code)).toContain("merged_parts");
    expect(run.flags.find((f) => f.code === "merged_parts")!.message).toContain("3.36 km + 9.01 km");
    expect(run.provenance.record_ids).toEqual(["a1", "a2"]);
    expect(run.provenance.steps.at(-1)!.rule).toBe("merge_split_session");
  });

  it("two runs an hour apart stay separate", () => {
    const morning = session({ id: "m", start: at("2026-09-22", "07:16:13"), duration_min: 14.6, distance_km: 1.7 });
    const later = session({ id: "l", start: at("2026-09-22", "08:30:50"), duration_min: 9.7, distance_km: 1.0 });
    expect(mergeSplitSessions([morning, later])).toHaveLength(2);
  });

  it("a run then a walk stay separate even when back to back", () => {
    const run = session({ id: "r", start: at("2026-09-22", "07:16:13"), duration_min: 14.6 });
    const walk = session({
      id: "w", start: at("2026-09-22", "07:31:00"), duration_min: 10, type: "walking", vendor_type: "walking",
    });
    expect(mergeSplitSessions([run, walk])).toHaveLength(2);
  });

  it("measures the gap from timer-time end, so a paused part reads a longer gap", () => {
    // Wall clock ends 07:40, but only 20 min on the timer: timer end 07:20, gap to 07:42 is 22 min.
    const paused = session({ id: "p", start: at("2026-10-01", "07:00"), duration_min: 20, end: at("2026-10-01", "07:40") });
    const next = session({ id: "n", start: at("2026-10-01", "07:42"), duration_min: 20 });
    expect(mergeSplitSessions([paused, next])).toHaveLength(2);
  });

  it("the gap boundary is inclusive at 10 minutes and a 0-minute gap merges", () => {
    const a = session({ id: "a", start: at("2026-10-01", "07:00"), duration_min: 30 });
    const tenLater = session({ id: "b", start: at("2026-10-01", "07:40"), duration_min: 10 });
    expect(mergeSplitSessions([a, tenLater])).toHaveLength(1);
    const elevenLater = session({ id: "c", start: at("2026-10-01", "07:41"), duration_min: 10 });
    expect(mergeSplitSessions([a, elevenLater])).toHaveLength(2);
    const touching = session({ id: "d", start: at("2026-10-01", "07:30"), duration_min: 10 });
    expect(mergeSplitSessions([a, touching])).toHaveLength(1);
  });

  it("chains three parts, measuring each gap from the previous part", () => {
    const a = session({ id: "a", start: at("2026-10-01", "07:00"), duration_min: 10, distance_km: 2 });
    const b = session({ id: "b", start: at("2026-10-01", "07:15"), duration_min: 10, distance_km: 2 });
    const c = session({ id: "c", start: at("2026-10-01", "07:30"), duration_min: 10, distance_km: 2 });
    const [one] = mergeSplitSessions([a, b, c]);
    expect(one!.parts).toEqual(["a", "b", "c"]);
    expect(one!.distance_km).toBe(6);
  });

  it("two easy parts can add up to a hard session", () => {
    const a = session({ id: "a", start: at("2026-10-01", "07:00"), duration_min: 30, hard_min: 12 });
    const b = session({ id: "b", start: at("2026-10-01", "07:32"), duration_min: 30, hard_min: 12 });
    expect(isHardSession(a) || isHardSession(b)).toBe(false);
    expect(isHardSession(mergeSplitSessions([a, b])[0]!)).toBe(true);
  });

  it("maxes training effect and recovery across parts and keeps the longest part's label", () => {
    const a = session({
      id: "a", start: at("2026-10-01", "07:00"), duration_min: 10,
      training_effect: { aerobic: 2.1, anaerobic: 1.5, label: "RECOVERY", source: "fit" },
      recovery: { hours: 10, basis: "device" },
    });
    const b = session({
      id: "b", start: at("2026-10-01", "07:12"), duration_min: 40,
      training_effect: { aerobic: 3.2, anaerobic: 0.4, label: "TEMPO", source: "fit" },
      recovery: { hours: 30, basis: "device" },
    });
    const [m] = mergeSplitSessions([a, b]);
    expect(m!.training_effect).toEqual({ aerobic: 3.2, anaerobic: 1.5, label: "TEMPO", source: "fit" });
    expect(m!.recovery).toEqual({ hours: 30, basis: "device" });
  });

  it("returns a single session unchanged", () => {
    const one = session({ id: "x", start: at("2026-10-20", "08:55:02"), duration_min: 62.2, distance_km: 8.02 });
    expect(mergeSplitSessions([one])).toEqual([one]);
  });
});

describe("isHardSession (SPEC §6.3)", () => {
  const base = { id: "s", start: at("2026-10-01", "07:00"), duration_min: 40 };
  const te = (aerobic: number | null, anaerobic: number | null) =>
    ({ aerobic, anaerobic, label: null, source: "api" as const });

  it.each([
    [te(3.0, 0.4), null, true],
    [te(2.9, 3.1), null, true],
    [te(2.0, 0.5), { hours: 24, basis: "device" as const }, true],
    [te(2.9, 2.9), { hours: 23, basis: "device" as const }, false],
    [null, null, false],
  ])("TE %o, recovery %o -> %s", (training_effect, recovery, expected) => {
    expect(isHardSession(session({ ...base, training_effect, recovery }))).toBe(expected);
  });

  it("an assumed recovery window never makes a session hard (that would be circular)", () => {
    expect(isHardSession(session({ ...base, recovery: { hours: 24, basis: "assumed" } }))).toBe(false);
  });

  it.each([[20, true], [19.9, false], [null, false]])("hard minutes %s -> %s", (hard_min, expected) => {
    expect(isHardSession(session({ ...base, hard_min }))).toBe(expected);
  });

  it("regression 9 Oct: strength sessions can be hard (>= 50 min at avg >= 115 bpm)", () => {
    const strength = (duration_min: number, avg_hr_bpm: number | null) =>
      session({ ...base, type: "strength", vendor_type: "strength_training", duration_min, avg_hr_bpm });
    expect(isHardSession(strength(68.75, 122))).toBe(true);
    expect(isHardSession(strength(50, 115))).toBe(true);
    expect(isHardSession(strength(70.75, 100))).toBe(false);
    expect(isHardSession(strength(49.9, 130))).toBe(false);
    expect(isHardSession(strength(90, 114))).toBe(false);
    // Strength only: a long walk at the same HR is not hard.
    expect(isHardSession(session({ ...base, type: "walking", duration_min: 70, avg_hr_bpm: 120 }))).toBe(false);
  });

  it("explains which arm fired, with scale and units", () => {
    const reasons = hardSessionReasons(session({ ...base, hard_min: 31.9, training_effect: te(3.4, null) }));
    expect(reasons).toEqual([
      "aerobic training effect 3.4 (0-5) >= 3",
      "31.9 min at or above HR zone 4 (>= 20 min)",
    ]);
  });
});
