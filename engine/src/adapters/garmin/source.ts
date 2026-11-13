/**
 * Recorded Garmin Connect responses on disk, for development and tests.
 *
 *   <root>/<kind>/<YYYY-MM-DD>.json   sleep, hrv, daily_summary, activities, max_metrics, fitness_age
 *   <root>/<kind>/<activityId>.json   activity_details, activity_splits, hr_zones
 *   <root>/fit/<activityId>.fit       the original device file
 *
 * Keys are "<kind>/<name>" without extension; json() adds ".json", bytes()
 * adds the kind's file extension. Missing files are null, not errors.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RawSource } from "../../adapter.ts";

const KEY = /^[a-z_]+\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9-]+)*$/;
const BYTES_EXTENSION: Record<string, string> = { fit: ".fit" };

export const DEFAULT_SNAPSHOT_ROOT = resolve(
  import.meta.dirname, "..", "..", "..", "..", "raw", "api", "api-responses",
);

export class SnapshotSource implements RawSource {
  readonly root: string;

  constructor(root: string = DEFAULT_SNAPSHOT_ROOT) {
    this.root = root;
  }

  async json(key: string): Promise<unknown | null> {
    const text = await this.#read(key, ".json");
    if (text === null) return null;
    try {
      return JSON.parse(text.toString("utf8"));
    } catch (error) {
      throw new Error(`snapshot ${key}.json is not valid JSON: ${(error as Error).message}`);
    }
  }

  async bytes(key: string): Promise<Uint8Array | null> {
    const kind = key.split("/")[0] ?? "";
    const data = await this.#read(key, BYTES_EXTENSION[kind] ?? "");
    return data === null ? null : new Uint8Array(data);
  }

  async #read(key: string, extension: string): Promise<Buffer | null> {
    if (!KEY.test(key) || key.includes("..")) throw new Error(`bad snapshot key: ${key}`);
    try {
      return await readFile(join(this.root, `${key}${extension}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
