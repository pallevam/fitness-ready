import { describe, expect, it } from "vitest";
import type { Night, Session, Daily } from "../../src/model.ts";
import { lastNight, nightLabel, readiness, type Check } from "../../src/meaning/index.ts";
import { at, dailies, night, session } from "./fixtures.ts";

const AS_OF = "2026-11-05";
const NOW = at(AS_OF, "08:00");

function verdict(over: { nights?: Night[]; dailies?: Daily[]; sessions?: Session[]; now?: string } = {}) {
  return readiness({
    as_of: AS_OF,
    now: over.now ?? NOW,
    nights: over.nights ?? [night("2026-11-04"), night(AS_OF)],
    dailies: over.dailies ?? dailies(AS_OF, 54, 55),
    sessions: over.sessions ?? [],
  });
}

function check(r: ReturnType<typeof verdict>, name: Check["name"]): Check {
  return r.checks.find((c) => c.name === name)!;
}

describe("nights", () => {
  it("labels a night by the day you woke", () => {
    expect(nightLabel("2026-11-05")).toBe("night of 2026-11-04 into 2026-11-05");
    expect(nightLabel("2026-03-01")).toBe("night of 2026-02-28 into 2026-03-01");
  });

  it("regression 20 Oct: last night missing -> not_synced, earlier night not substituted", () => {
    const { night: n, flags } = lastNight([night("2026-11-03"), night("2026-11-04")], AS_OF);
    expect(n).toBeNull();
    expect(flags).toHaveLength(1);
    expect(flags[0]!.code).toBe("not_synced");
    expect(flags[0]!.message).toContain("night of 2026-11-04 into 2026-11-05");
  });

  it("returns the night whose wake date is asOf", () => {
    expect(lastNight([night("2026-11-04"), night(AS_OF)], AS_OF).night?.wake_date).toBe(AS_OF);
  });
});

describe("readiness (SPEC §8)", () => {
  it("all four checks pass is green, with units and scales in every value", () => {
    const r = verdict();
    expect(r.colour).toBe("green");
    expect(r.based_on).toBe("4 of 4 checks");
    expect(check(r, "sleep").value).toBe("score 80 (0-100)");
    expect(check(r, "hrv").value).toBe("60 ms, within baseline 55-70 ms");
    expect(check(r, "resting_hr").value).toBe("+1 bpm vs 30-day mean 54 bpm (today 55 bpm)");
    expect(check(r, "recovery").value).toBe("no hard session on record");
    expect(r.how_built.at(-1)!.rule).toBe("readiness_verdict");
  });

  it("one failure is amber, two is red", () => {
    expect(verdict({ dailies: dailies(AS_OF, 54, 57.1) }).colour).toBe("amber");
    const hard = session({ id: "h", start: at(AS_OF, "06:00"), duration_min: 40, hard_min: 25 });
    expect(verdict({ dailies: dailies(AS_OF, 54, 58), sessions: [hard] }).colour).toBe("red");
  });

  it("boundaries are inclusive where the rubric says", () => {
    expect(verdict({ nights: [night(AS_OF, { score: { value: 70, min: 0, max: 100 } })] }).colour).toBe("green");
    expect(verdict({ nights: [night(AS_OF, { score: { value: 69, min: 0, max: 100 } })] }).colour).toBe("amber");
    expect(verdict({ dailies: dailies(AS_OF, 54, 57) }).colour).toBe("green");
    expect(verdict({ nights: [night(AS_OF, { hrv_avg_ms: 55 })] }).colour).toBe("green");
    expect(verdict({ nights: [night(AS_OF, { hrv_avg_ms: 54 })] }).failed).toEqual(["hrv"]);
  });

  it("untrustworthy (off-wrist) sleep is a failure, not missing", () => {
    const offWrist = night(AS_OF, { validation: "off_wrist", asleep_min: 0, score: null });
    const r = verdict({ nights: [offWrist] });
    expect(r.failed).toEqual(["sleep"]);
    expect(r.colour).toBe("amber");
    expect(check(r, "sleep").value).toContain("off_wrist");
  });

  it("regression: a user_reported night is untrustworthy (MANUAL in SPEC §6.3) and flagged", () => {
    const manual = night(AS_OF, { validation: "user_reported", score: { value: 85, min: 0, max: 100 } });
    const r = verdict({ nights: [manual] });
    expect(check(r, "sleep").result).toBe("fail");
    expect(check(r, "sleep").value).toContain("entered by hand");
    expect(r.flags.map((f) => f.code)).toContain("user_reported");
  });

  it("regression: an imputed night is trusted but flagged, and the value says so", () => {
    const imputed = night(AS_OF, { validation: "imputed", score: { value: 75, min: 0, max: 100 } });
    const r = verdict({ nights: [imputed] });
    expect(check(r, "sleep").result).toBe("pass");
    expect(check(r, "sleep").value).toBe("score 75 (0-100), some values imputed");
    expect(r.flags.map((f) => f.code)).toContain("imputed");
  });

  it("a night with no sleep minutes is untrustworthy", () => {
    expect(verdict({ nights: [night(AS_OF, { asleep_min: null })] }).failed).toEqual(["sleep"]);
  });

  it("a score on another scale is compared on 0-100 and shown on its own scale", () => {
    const r = verdict({ nights: [night(AS_OF, { score: { value: 3, min: 1, max: 4 } })] });
    expect(check(r, "sleep").value).toBe("score 3 (1-4), 66.7 on 0-100");
    expect(check(r, "sleep").result).toBe("fail");
  });

  it("no HRV baseline yet is missing and does not cap the colour", () => {
    const r = verdict({ nights: [night(AS_OF, { hrv_baseline_low_ms: null, hrv_baseline_high_ms: null })] });
    expect(r.missing).toEqual(["hrv"]);
    expect(check(r, "hrv").value).toBe("no baseline yet");
    expect(r.colour).toBe("green");
    expect(r.based_on).toBe("3 of 4 checks");
  });

  it("regression 5 Oct: last night not synced -> two missing checks -> insufficient_data, not red", () => {
    const r = verdict({ nights: [night("2026-11-04")] });
    expect(r.missing).toEqual(["sleep", "hrv"]);
    expect(r.colour).toBe("insufficient_data");
    expect(r.flags.map((f) => f.code)).toContain("not_synced");
    // The earlier night's numbers must not leak into the checks.
    expect(check(r, "hrv").value).toBe("no HRV last night");
  });

  it("resting HR excludes today from the 30-day mean and notes a short baseline", () => {
    const r = verdict({ dailies: dailies(AS_OF, 54, 58.6, 10) });
    expect(check(r, "resting_hr").value).toBe("+4.6 bpm vs 30-day mean 54 bpm (today 58.6 bpm)");
    expect(r.flags.find((f) => f.code === "partial")!.message).toBe("Resting HR baseline built from 10 of 30 days.");
  });

  it("no resting HR today is missing", () => {
    expect(verdict({ dailies: dailies(AS_OF, 54, null) }).missing).toEqual(["resting_hr"]);
  });

  it("regression 17 Oct: a hard session with no device recovery fails recovery on an assumed 24 h, labelled", () => {
    const run = session({ id: "r", start: at(AS_OF, "06:00"), duration_min: 40, hard_min: 31.9 });
    const r = verdict({ sessions: [run], now: at(AS_OF, "15:40") });
    const rec = check(r, "recovery");
    expect(rec.result).toBe("fail");
    expect(rec.value).toBe(
      "15 h remaining (assumed 24 h after a hard session that ended 9 h ago; the device gave no recovery time)",
    );
    expect(r.colour).toBe("amber");
    expect(r.flags.map((f) => f.code)).toContain("assumed");
  });

  it("regression 2 Nov: the readiness recovery check counts to now, from the session's end", () => {
    const strength = session({
      id: "s", type: "strength", vendor_type: "strength_training",
      start: at("2026-11-01", "12:44"), duration_min: 51, avg_hr_bpm: 120,
    });
    const r = readiness({
      as_of: "2026-11-02", now: at("2026-11-02", "11:02"),
      nights: [night("2026-11-02")], dailies: dailies("2026-11-02", 54, 55), sessions: [strength],
    });
    expect(check(r, "recovery").value).toContain("ended 21.5 h ago");
    expect(check(r, "recovery").value).toMatch(/^2\.5 h remaining/);
  });

  it("a past as-of day counts recovery to that day's end, ignoring later sessions", () => {
    const run = session({ id: "r", start: at(AS_OF, "06:00"), duration_min: 60, hard_min: 30 });
    const later = session({ id: "later", start: at("2026-11-06", "06:00"), duration_min: 60, hard_min: 30 });
    const r = verdict({ sessions: [run, later], now: at("2026-11-09", "09:00") });
    // 07:00 to midnight is 17 h; 24 - 17 = 7 h remaining.
    expect(check(r, "recovery").value).toMatch(/^7 h remaining/);
  });

  it("recovered once the window has passed", () => {
    const run = session({ id: "r", start: at("2026-11-03", "06:00"), duration_min: 40, hard_min: 25 });
    expect(check(verdict({ sessions: [run] }), "recovery").result).toBe("pass");
  });

  it("every check carries a how-built step", () => {
    const rules = verdict().how_built.map((s) => s.rule);
    for (const rule of ["last_night", "sleep_check", "hrv_check", "resting_hr_check", "reference_time", "readiness_verdict"]) {
      expect(rules).toContain(rule);
    }
  });
});
