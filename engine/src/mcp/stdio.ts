/**
 * Local entry: the MCP server over stdio, for a desktop assistant on the
 * user's own machine (the privacy-strict mode). Data never leaves the machine
 * except as the tool answers the assistant asks for.
 *
 *   node src/mcp/stdio.ts                       # snapshots under ../raw/api/api-responses
 *   FITNESS_READY_SNAPSHOTS=/path FITNESS_READY_TZ=Asia/Kolkata node src/mcp/stdio.ts
 *
 * stdout carries the protocol; anything human-readable goes to stderr.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Adapter } from "../adapter.ts";
import { checkTz, localNow, systemTz } from "./clock.ts";
import { Engine } from "./engine.ts";
import { buildServer } from "./server.ts";

/** Builds the adapters for one Engine. stdio has one user, so it is called once. */
export type AdapterFactory = (opts: { tz: string }) => Promise<Adapter[]>;

const GARMIN_MODULE = new URL("../adapters/garmin/index.ts", import.meta.url);
const DEFAULT_SNAPSHOTS = fileURLToPath(new URL("../../../raw/api/api-responses", import.meta.url));

/**
 * Garmin over recorded API snapshots. The adapter module is written
 * separately; it is expected to export `SnapshotSource` (constructed with the
 * snapshot root) and `GarminAdapter` (constructed with a RawSource and
 * `{ tz }`). Loaded dynamically so this file builds before that module exists.
 */
export const garminSnapshots =
  (root = process.env.FITNESS_READY_SNAPSHOTS ?? DEFAULT_SNAPSHOTS): AdapterFactory =>
  async ({ tz }) => {
    if (!existsSync(fileURLToPath(GARMIN_MODULE))) {
      throw new Error(`Garmin adapter not found at ${fileURLToPath(GARMIN_MODULE)}; it must exist before the stdio server can start.`);
    }
    if (!existsSync(root)) {
      throw new Error(`Snapshot directory ${root} not found; set FITNESS_READY_SNAPSHOTS.`);
    }
    const mod = (await import(GARMIN_MODULE.href)) as Record<string, unknown>;
    const Source = mod.SnapshotSource as (new (root: string) => unknown) | undefined;
    const Garmin = mod.GarminAdapter as (new (source: unknown, opts: { tz: string }) => Adapter) | undefined;
    if (typeof Source !== "function" || typeof Garmin !== "function") {
      throw new Error("adapters/garmin/index.ts must export SnapshotSource and GarminAdapter classes.");
    }
    return [new Garmin(new Source(root), { tz })];
  };

export async function main(factory: AdapterFactory = garminSnapshots()): Promise<void> {
  const tz = checkTz(process.env.FITNESS_READY_TZ ?? systemTz());
  const adapters = await factory({ tz });
  const engine = new Engine({ adapters, tz, now: () => localNow(tz) });
  const server = buildServer(engine);
  await server.connect(new StdioServerTransport());
  console.error(`fitness-ready MCP server on stdio (tz ${tz}, ${adapters.map((a) => a.vendor).join(", ")})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
