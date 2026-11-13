import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { startHttpServer, type HttpOptions } from "../../src/mcp/http.ts";
import { FakeAdapter, TZ } from "./fixtures.ts";

let server: Server | undefined;
afterEach(async () => {
  await new Promise((r) => server?.close(r) ?? r(undefined));
  server = undefined;
});

async function start(extra: Partial<HttpOptions> = {}) {
  const lines: string[] = [];
  let built = 0;
  server = await startHttpServer(
    {
      adapters: async () => {
        built += 1;
        return [new FakeAdapter()];
      },
      tz: () => TZ,
      log: (l) => lines.push(l),
      ...extra,
    },
    0,
  );
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return { url, lines, built: () => built };
}

describe("stateless Streamable HTTP", () => {
  it("serves tools with a fresh engine per request and no session id", async () => {
    const s = await start();
    const transport = new StreamableHTTPClientTransport(new URL(s.url));
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    expect(transport.sessionId).toBeUndefined();

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    const res = (await client.callTool({ name: "get_nights", arguments: { start: "2026-11-01", end: "2026-11-03" } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as any).data.count).toBe(3);
    await client.close();

    // initialize, initialized, tools/list, tools/call: one engine each, none kept.
    expect(s.built()).toBeGreaterThanOrEqual(3);
    // Access log: method, path, status, duration. No bodies, no dates asked for.
    for (const l of s.lines) expect(l).toMatch(/^(POST|GET|DELETE) \/mcp \d{3} \d+ms$/);
    expect(s.lines.join("\n")).not.toContain("2026-11-0");
  });

  it("refuses GET and DELETE: no SSE stream, no session to end", async () => {
    const s = await start();
    for (const method of ["GET", "DELETE"]) {
      const r = await fetch(s.url, { method });
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
  });

  it("auth seam: no AuthInfo is a 401 before any adapter is built", async () => {
    const s = await start({ authenticate: async (req) => (req.headers.authorization === "Bearer good" ? { token: "good", clientId: "c", scopes: [] } : null) });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const r = await fetch(s.url, { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(s.built()).toBe(0);
  });
});
