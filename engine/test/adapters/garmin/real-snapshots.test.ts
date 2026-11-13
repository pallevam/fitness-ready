/**
 * Structural sanity against the developer's own recorded Garmin data, when it
 * exists (raw/ is gitignored, so CI skips this). Asserts shapes and ranges
 * only; failure messages name counts and ids at most, never personal values.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { GarminAdapter } from "../../../src/adapters/garmin/adapter.ts";
import { decodeFit, readFitMsg140 } from "../../../src/adapters/garmin/fit.ts";
import { DEFAULT_SNAPSHOT_ROOT, SnapshotSource } from "../../../src/adapters/garmin/source.ts";

const root = DEFAULT_SNAPSHOT_ROOT;
const present = existsSync(join(root, "sleep"));

function dates(kind: string): string[] {
  const dir = join(root, kind);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, 10)).sort() : [];
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/;
const count = (xs: unknown[], pred: (x: never) => boolean) => xs.filter((x) => !pred(x as never)).length;

describe.skipIf(!present)("real Garmin snapshots (local only)", () => {
  const adapter = new GarminAdapter(new SnapshotSource(root), { tz: "Asia/Kolkata" });
  const all = dates("sleep");
  const range = { start: all[0] ?? "2026-01-01", end: all.at(-1) ?? "2026-01-01" };

  it("nights: wake-dated, 0-100 scores, +05:30 times, end on the wake date", async () => {
    const nights = await adapter.nights(range);
    expect(nights.length).toBeGreaterThan(0);
    expect(count(nights, (n: (typeof nights)[number]) => /^\d{4}-\d{2}-\d{2}$/.test(n.wake_date) && n.label.endsWith(`into ${n.wake_date}`))).toBe(0);
    expect(count(nights, (n: (typeof nights)[number]) => LOCAL.test(n.start) && LOCAL.test(n.end) && n.end.startsWith(n.wake_date))).toBe(0);
    expect(count(nights, (n: (typeof nights)[number]) => n.score === null || (n.score.min === 0 && n.score.max === 100 && n.score.value >= 0 && n.score.value <= 100))).toBe(0);
    expect(count(nights, (n: (typeof nights)[number]) => n.tz === "Asia/Kolkata" && n.provenance.vendor === "garmin")).toBe(0);
    expect(count(nights, (n: (typeof nights)[number]) => n.asleep_min === null || (n.asleep_min > 0 && n.asleep_min < 24 * 60))).toBe(0);
  });

  it("dailies: stress on 0-100 or null, intensity minutes non-negative", async () => {
    const days = await adapter.dailies(range);
    expect(days.length).toBeGreaterThan(0);
    expect(count(days, (d: (typeof days)[number]) => d.stress_avg === null || (d.stress_avg.value >= 0 && d.stress_avg.value <= 100 && d.stress_avg.max === 100))).toBe(0);
    expect(count(days, (d: (typeof days)[number]) => d.intensity_min === null || d.intensity_min >= 0)).toBe(0);
  });

  it("sessions: local times, positive durations, no numeric suffix in labels", async () => {
    const sessions = await adapter.sessions({ start: dates("activities")[0] ?? range.start, end: dates("activities").at(-1) ?? range.end });
    expect(sessions.length).toBeGreaterThan(0);
    expect(count(sessions, (s: (typeof sessions)[number]) => LOCAL.test(s.start) && LOCAL.test(s.end) && s.duration_min > 0 && s.elapsed_min >= s.duration_min - 0.1)).toBe(0);
    expect(count(sessions, (s: (typeof sessions)[number]) => !/_\d+$/.test(s.training_effect?.label ?? ""))).toBe(0);
  });

  const fitIds = existsSync(join(root, "fit"))
    ? readdirSync(join(root, "fit")).filter((f) => f.endsWith(".fit")).map((f) => f.slice(0, -4))
    : [];

  it.skipIf(fitIds.length === 0)("FIT detail: msg-140 TE within 0-5, recovery within 0-96 h, no GPS", async () => {
    let bad = 0;
    for (const id of fitIds) {
      const detail = await adapter.sessionDetail(id);
      const te = detail?.session.training_effect;
      const rec = detail?.session.recovery;
      const ok = detail !== null &&
        te?.source === "fit" &&
        [te.aerobic, te.anaerobic].every((v) => v !== null && v >= 0 && v <= 5) &&
        rec !== null && rec !== undefined && rec.basis === "device" && rec.hours >= 0 && rec.hours <= 96 &&
        detail.samples.length > 0 && detail.samples.every((s) => LOCAL.test(s.t)) &&
        !/lat|long|position/i.test(JSON.stringify(detail));
      if (!ok) bad++;
    }
    expect(bad, `${bad} of ${fitIds.length} activities failed the FIT checks`).toBe(0);
  });

  it.skipIf(fitIds.length === 0)("list sessions with a FIT carry device recovery; the cheap reader matches the SDK", async () => {
    let mismatched = 0;
    for (const id of fitIds) {
      const bytes = new Uint8Array(readFileSync(join(root, "fit", `${id}.fit`)));
      if (JSON.stringify(readFitMsg140(bytes)) !== JSON.stringify(decodeFit(bytes).msg140)) mismatched++;
    }
    expect(mismatched, `${mismatched} of ${fitIds.length} files disagree`).toBe(0);
    const sessions = await adapter.sessions({ start: dates("activities")[0] ?? range.start, end: dates("activities").at(-1) ?? range.end });
    const withFit = sessions.filter((s) => fitIds.includes(s.id));
    expect(withFit.length).toBeGreaterThan(0);
    expect(count(withFit, (s: (typeof withFit)[number]) => s.recovery?.basis === "device" && s.training_effect?.source === "fit")).toBe(0);
  });
});
