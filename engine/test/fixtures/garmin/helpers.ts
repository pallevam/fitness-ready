import { resolve } from "node:path";

import type { RawSource } from "../../../src/adapter.ts";
import { SnapshotSource } from "../../../src/adapters/garmin/source.ts";

export const FIXTURE_ROOT = resolve(import.meta.dirname);

/** The JSON fixtures on disk, plus FIT files built in memory by the test. */
export class FixtureSource implements RawSource {
  readonly #disk = new SnapshotSource(FIXTURE_ROOT);
  readonly fit = new Map<string, Uint8Array>();
  readonly json = (key: string) => this.#disk.json(key);
  async bytes(key: string): Promise<Uint8Array | null> {
    return this.fit.get(key) ?? null;
  }
}

/** 2026-03-02 01:30:00Z, the synthetic run's start. */
export const RUN_START_UTC = Date.parse("2026-03-02T01:30:00Z");
export const IST = 330;
