import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SnapshotSource } from "../../../src/adapters/garmin/source.ts";
import { datesIn, offsetMinutes, toLocalIso, tzName, wallToLocalIso } from "../../../src/adapters/garmin/time.ts";
import { FIXTURE_ROOT } from "../../fixtures/garmin/helpers.ts";

describe("SnapshotSource", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "garmin-snap-"));
    await mkdir(join(dir, "fit"));
    await mkdir(join(dir, "sleep"));
    await writeFile(join(dir, "fit", "42.fit"), new Uint8Array([1, 2, 3]));
    await writeFile(join(dir, "sleep", "2026-01-01.json"), "{not json");
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("reads <kind>/<date>.json and returns null when missing", async () => {
    const source = new SnapshotSource(FIXTURE_ROOT);
    expect(await source.json("hrv/2026-03-02")).toMatchObject({ hrvSummary: { lastNightAvg: 63 } });
    expect(await source.json("hrv/2026-03-09")).toBeNull();
  });

  it("reads FIT bytes under fit/<id>.fit", async () => {
    const source = new SnapshotSource(dir);
    expect(await source.bytes("fit/42")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await source.bytes("fit/43")).toBeNull();
  });

  it("refuses keys that leave the root, and reports corrupt JSON", async () => {
    const source = new SnapshotSource(dir);
    await expect(source.json("../etc/passwd")).rejects.toThrow(/bad snapshot key/);
    await expect(source.json("sleep/../../x")).rejects.toThrow(/bad snapshot key/);
    await expect(source.json("sleep/2026-01-01")).rejects.toThrow(/not valid JSON/);
  });
});

describe("time", () => {
  it("derives the offset from local and GMT readings", () => {
    expect(offsetMinutes("2026-11-05 17:54:28", "2026-11-05 12:24:28")).toBe(330);
    expect(offsetMinutes(1_000_000 + 19_800_000, 1_000_000)).toBe(330);
    expect(offsetMinutes("2026-03-01 20:00:00", "2026-03-02 01:00:00")).toBe(-300);
    expect(offsetMinutes(null, "2026-03-02 01:00:00")).toBeNull();
  });

  it("formats local ISO with offset", () => {
    const utc = Date.parse("2026-11-04T21:29:00Z");
    expect(toLocalIso(utc, 330)).toBe("2026-11-05T02:59:00+05:30");
    expect(wallToLocalIso(Date.parse("2026-11-05T02:59:00Z"), 330)).toBe("2026-11-05T02:59:00+05:30");
  });

  it("names the zone only when its offset matches", () => {
    const t = Date.parse("2026-07-01T00:00:00Z");
    expect(tzName("Asia/Kolkata", t, 330)).toBe("Asia/Kolkata");
    expect(tzName("Asia/Kolkata", t, 60)).toBe("+01:00");
    expect(tzName("Not/AZone", t, 330)).toBe("+05:30");
    expect(tzName(undefined, t, -270)).toBe("-04:30");
  });

  it("lists dates inclusively", () => {
    expect(datesIn("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});
