import { describe, expect, it } from "vitest";
import { ASSUMED_RECOVERY_H, recoveryStatus, referenceInstant } from "../../src/meaning/index.ts";
import { at, session } from "./fixtures.ts";

const hardStrength = session({
  id: "s1", type: "strength", vendor_type: "strength_training",
  start: at("2026-11-01", "12:44"), duration_min: 51, avg_hr_bpm: 120,
});

describe("recoveryStatus", () => {
  it("regression 2 Nov: counts from the session's end to now, not start-to-18:00", () => {
    // Strength 12:44-13:35 on 1 Nov; asked at 11:02 on 2 Nov -> 21.5 h, not 29.3 h.
    const status = recoveryStatus([hardStrength], at("2026-11-02", "11:02"));
    expect(status.last_hard?.id).toBe("s1");
    expect(status.hours_since).toBe(21.5);
    expect(status.remaining_h).toBe(2.5);
    expect(status.steps.map((s) => s.rule)).toContain("recovery_from_end");
    expect(status.steps.find((s) => s.rule === "recovery_from_end")!.detail).toContain("13:35");
  });

  it("regression 17 Oct: no device recovery -> assumed 24 h with basis 'assumed'", () => {
    const run = session({ id: "r", start: at("2026-10-17", "07:00"), duration_min: 40, hard_min: 31.9 });
    const status = recoveryStatus([run], at("2026-10-17", "16:40"));
    expect(status.basis).toBe("assumed");
    expect(status.hours_since).toBe(9);
    expect(status.remaining_h).toBe(ASSUMED_RECOVERY_H - 9);
    expect(status.steps.map((s) => s.rule)).toContain("assumed_recovery");
  });

  it("uses the device's recovery hours when given", () => {
    const run = session({
      id: "r", start: at("2026-10-17", "07:00"), duration_min: 40,
      training_effect: { aerobic: 3.5, anaerobic: 1, label: null, source: "api" },
      recovery: { hours: 36, basis: "device" },
    });
    const status = recoveryStatus([run], at("2026-10-18", "07:40"));
    expect(status.basis).toBe("device");
    expect(status.remaining_h).toBe(12);
  });

  it("picks the most recent hard session and ignores easy ones and future ones", () => {
    const older = session({ id: "old", start: at("2026-11-01", "07:00"), duration_min: 40, hard_min: 25 });
    const easy = session({ id: "easy", start: at("2026-11-02", "07:00"), duration_min: 40, hard_min: 2 });
    const later = session({ id: "later", start: at("2026-11-02", "20:00"), duration_min: 40, hard_min: 25 });
    const status = recoveryStatus([older, easy, later], at("2026-11-02", "12:00"));
    expect(status.last_hard?.id).toBe("old");
  });

  it("no hard session: nothing to recover from, and says so", () => {
    const status = recoveryStatus([], at("2026-11-02", "12:00"));
    expect(status).toMatchObject({ last_hard: null, hours_since: null, remaining_h: null, basis: null });
    expect(status.steps).toHaveLength(1);
  });

  it("never reports negative hours for a session still in progress", () => {
    const now = at("2026-11-02", "07:20");
    const ongoing = session({ id: "o", start: at("2026-11-02", "07:00"), duration_min: 40, hard_min: 25 });
    expect(recoveryStatus([ongoing], now).hours_since).toBe(0);
  });
});

describe("referenceInstant", () => {
  it("is now on the current day", () => {
    expect(referenceInstant("2026-11-02", at("2026-11-02", "11:02"))).toBe(at("2026-11-02", "11:02"));
  });
  it("is the end of a past day", () => {
    expect(referenceInstant("2026-09-13", at("2026-11-02", "11:02"))).toBe("2026-09-14T00:00:00+05:30");
  });
});
