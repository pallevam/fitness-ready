/**
 * The MCP surface: five read-only tools over one Engine. Transport-agnostic;
 * stdio.ts and http.ts decide where the Engine's adapters come from.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { compact } from "./format.ts";
import { Engine, EngineInputError, MAX_NIGHTS_DAYS, MAX_SESSIONS_DAYS, type Envelope } from "./engine.ts";

export const SERVER_NAME = "fitness-ready";
export const SERVER_VERSION = "0.1.0";

/** Said once to the assistant at connect time; each tool description repeats the essentials. */
export const INSTRUCTIONS = `Answers about the user's own wearable data (sleep, HRV, resting heart rate, workouts, recovery).
Start with get_brief for any "how am I doing / should I train" question; it already connects last night, the 7-night trend, the week's sessions, readiness and recovery.
Every result is {data, flags, how_built, as_of}.
- Cite the numbers you use with their dates (a night is dated by the day the user woke: "the night into 5 Nov").
- Relay every warn flag in plain words, and lower your confidence accordingly. If last night is not_synced, say so; never substitute an earlier night.
- Use how_built when the user asks how a number was worked out.
- Scores carry their scale, e.g. "3 (1-4)"; never restate one as out of 100.
- Describe, don't diagnose. For symptoms (chest pain, fainting, dizziness), medication, or anything clinical, say it is outside what this data can answer and suggest a clinician.`;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .describe("Local calendar date, YYYY-MM-DD");

const sessionType = z.enum(["running", "walking", "cycling", "swimming", "strength", "cardio", "other"]);

const flagSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warn"]),
  message: z.string(),
  field: z.string().optional(),
  on: z.string().optional(),
});

/** The shape every tool returns; `data` differs per tool. */
const envelopeSchema = {
  data: z.record(z.string(), z.unknown()),
  flags: z.array(flagSchema),
  how_built: z.array(z.object({ rule: z.string(), detail: z.string() })),
  as_of: z.string(),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const CITE = "Cite numbers with their dates, relay warn flags, and never diagnose.";

export function buildServer(engine: Engine): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "get_brief",
    {
      title: "Daily brief",
      description: `The main tool: everything needed for "how am I doing / should I train today", in one call. Returns last night (or last_night_status "not_synced" with a flag; never an earlier night), the 7-night trend of HRV, resting HR and sleep against the 60-night HRV mean and baseline band, sessions in the last 7 days (split recordings already joined), the readiness colour with its four checks, and recovery remaining from the last hard session. ${CITE} Defaults to today.`,
      inputSchema: { date: date.optional().describe("Day to brief, YYYY-MM-DD; defaults to today") },
      outputSchema: envelopeSchema,
      annotations: { title: "Daily brief", ...READ_ONLY },
    },
    async ({ date }) => respond("get_brief", () => engine.brief(date)),
  );

  server.registerTool(
    "get_readiness",
    {
      title: "Readiness",
      description: `Readiness colour (green / amber / red / insufficient_data) from four visible checks: sleep, HRV vs baseline, resting HR vs 30-day mean, recovery remaining. Each check shows its value and rule, so explain the colour by naming the check that drove it. A missing input is not a failed check. ${CITE} Use get_brief instead when the user wants the wider picture.`,
      inputSchema: { date: date.optional().describe("Day to judge, YYYY-MM-DD; defaults to today") },
      outputSchema: envelopeSchema,
      annotations: { title: "Readiness", ...READ_ONLY },
    },
    async ({ date }) => respond("get_readiness", () => engine.readiness(date)),
  );

  server.registerTool(
    "get_nights",
    {
      title: "Nights",
      description: `Sleep nights whose wake date is in start..end (inclusive, at most ${MAX_NIGHTS_DAYS} days per call): stages in minutes, score with its scale, HRV and its baseline band, resting HR, respiration, and how the night was validated. missing_nights lists dates with no data, so "5 of 7 nights" stays honest. ${CITE}`,
      inputSchema: {
        start: date.describe("First wake date, YYYY-MM-DD"),
        end: date.describe(`Last wake date, YYYY-MM-DD; at most ${MAX_NIGHTS_DAYS} days after start`),
      },
      outputSchema: envelopeSchema,
      annotations: { title: "Nights", ...READ_ONLY },
    },
    async ({ start, end }) => respond("get_nights", () => engine.nights(start, end)),
  );

  server.registerTool(
    "get_sessions",
    {
      title: "Sessions",
      description: `Workouts started in start..end (inclusive, at most ${MAX_SESSIONS_DAYS} days per call), optionally one type. Recordings saved in parts are already joined into one session (parts > 1 and a merged_parts flag say so). totals has counts, hard sessions, duration and distance per type: quote those rather than adding rows yourself. For laps, zones or heart-rate detail call get_session_detail with an id. ${CITE}`,
      inputSchema: {
        start: date.describe("First day, YYYY-MM-DD"),
        end: date.describe(`Last day, YYYY-MM-DD; at most ${MAX_SESSIONS_DAYS} days after start`),
        type: sessionType.optional().describe("Only this activity type"),
      },
      outputSchema: envelopeSchema,
      annotations: { title: "Sessions", ...READ_ONLY },
    },
    async ({ start, end, type }) => respond("get_sessions", () => engine.sessions(start, end, type)),
  );

  server.registerTool(
    "get_session_detail",
    {
      title: "Session detail",
      description: `One workout in depth: laps, heart-rate zone minutes, the device's training effect and recovery hours, and sensor_spike flags when heart-rate samples show physiologically implausible jumps (treat a flagged max HR as an artefact, not effort). Parts of a split recording are combined. Raw samples are left out unless include_samples is true; then at most 300 points, columnar. ${CITE}`,
      inputSchema: {
        session_id: z.string().min(1).max(64).describe("Session id from get_sessions or get_brief"),
        include_samples: z.boolean().optional().describe("Add downsampled time series (only when the user asks for the curve itself)"),
      },
      outputSchema: envelopeSchema,
      annotations: { title: "Session detail", ...READ_ONLY },
    },
    async ({ session_id, include_samples }) =>
      respond("get_session_detail", () => engine.sessionDetail(session_id, include_samples ?? false)),
  );

  return server;
}

/** Envelope -> JSON text (for every client) plus structuredContent (for clients that read it). */
async function respond(tool: string, run: () => Promise<Envelope<object>>): Promise<CallToolResult> {
  try {
    const out = compact(await run()) as unknown as Record<string, unknown>;
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
  } catch (err) {
    if (err instanceof EngineInputError) return toolError(err.message);
    // Never echo internals to the assistant. Log the error, never arguments or payloads.
    // Error class only: adapter messages can carry URLs, tokens or response fragments.
    console.error(`[${tool}] failed: ${err instanceof Error ? err.name : typeof err}`);
    return toolError("The wearable data could not be read just now. Tell the user and suggest trying again shortly.");
  }
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
