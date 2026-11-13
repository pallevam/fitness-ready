/**
 * Remote entry: stateless Streamable HTTP, for assistants that connect over
 * the network (claude.ai, ChatGPT connectors).
 *
 * Stateless by construction: every POST builds a fresh Engine, McpServer and
 * transport, answers, and drops them. No session ids, no session store, no
 * cache: health data exists only in flight, for the length of one request.
 * Responses are plain JSON (no SSE), since every tool answers in one shot.
 *
 * Auth seam: `authenticate` turns the request's bearer token into an AuthInfo
 * (null = 401); `adapters` turns that AuthInfo into per-request adapters
 * carrying that user's vendor credentials. Neither is wired to OAuth yet.
 *
 * Logging: method, path, status and duration only. Never bodies, never
 * headers (the bearer token lives there), never tool arguments.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Adapter } from "../adapter.ts";
import { checkTz, localNow, systemTz } from "./clock.ts";
import { Engine } from "./engine.ts";
import { buildServer } from "./server.ts";
import { garminSnapshots } from "./stdio.ts";

export const MCP_PATH = "/mcp";
/** Tool calls are tiny; anything bigger is not a legitimate request. */
const MAX_BODY_BYTES = 64 * 1024;

export interface RequestContext {
  /** Null only when no authenticator is configured (local development). */
  auth: AuthInfo | null;
}

export interface HttpOptions {
  /** Per-request adapters, built from the caller's credentials. Must not cache user data. */
  adapters: (ctx: RequestContext) => Promise<Adapter[]>;
  /** The user's IANA zone; later from their profile or token claims. */
  tz: (ctx: RequestContext) => string;
  /**
   * OAuth seam: validate `Authorization: Bearer ...` and return the AuthInfo,
   * or null to answer 401. Omitted = no auth (development only).
   */
  authenticate?: (req: IncomingMessage) => Promise<AuthInfo | null>;
  /** Where the one-line access log goes. */
  log?: (line: string) => void;
}

export function createMcpHttpHandler(opts: HttpOptions) {
  const log = opts.log ?? ((line: string) => console.error(line));

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const path = (req.url ?? "/").split("?")[0];
    res.on("finish", () => log(`${req.method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`));

    if (path === "/healthz" && req.method === "GET") return void res.writeHead(200).end("ok");
    if (path !== MCP_PATH) return void res.writeHead(404).end();
    if (req.method !== "POST") {
      // Stateless: no standalone SSE stream (GET) and no session to delete (DELETE).
      return jsonRpcError(res, 405, -32000, "Method not allowed; this server is stateless, POST only.", { Allow: "POST" });
    }

    let auth: AuthInfo | null = null;
    if (opts.authenticate) {
      auth = await opts.authenticate(req);
      if (!auth) return jsonRpcError(res, 401, -32001, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="fitness-ready"' });
    }

    const ctx: RequestContext = { auth };
    let server: ReturnType<typeof buildServer> | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
      const tz = opts.tz(ctx);
      const engine = new Engine({ adapters: await opts.adapters(ctx), tz, now: () => localNow(tz) });
      server = buildServer(engine);
      transport = new StreamableHTTPServerTransport({
        // No sessionIdGenerator: the SDK's stateless mode (no session ids, no validation).
        enableJsonResponse: true,
        maxRequestBodySize: MAX_BODY_BYTES,
      });
      res.on("close", () => {
        void transport?.close();
        void server?.close();
      });
      await server.connect(transport);
      await transport.handleRequest(auth ? Object.assign(req, { auth }) : req, res);
    } catch (err) {
      log(`mcp request failed: ${err instanceof Error ? err.name : typeof err}`);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  };
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res
    .writeHead(status, { "Content-Type": "application/json", ...headers })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

export function startHttpServer(opts: HttpOptions, port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer((req, res) => void createMcpHttpHandler(opts)(req, res));
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // Development wiring: no auth, recorded snapshots, bound to localhost.
  const tz = checkTz(process.env.FITNESS_READY_TZ ?? systemTz());
  const factory = garminSnapshots();
  const port = Number(process.env.PORT ?? 8787);
  startHttpServer({ adapters: () => factory({ tz }), tz: () => tz }, port)
    .then(() => console.error(`fitness-ready MCP (stateless HTTP, NO AUTH, dev) on http://127.0.0.1:${port}${MCP_PATH}`))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
