import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// `agents/mcp` imports Cloudflare runtime-only modules that Node's ESM loader
// cannot resolve. Keep this a unit test by replacing only that thin adapter;
// the real MCP SDK transport and application server still process every call.
vi.mock("agents/mcp", async () => {
  const { WebStandardStreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
  );

  const corsHeaders = (preflight: boolean): Record<string, string> => ({
    "Access-Control-Allow-Origin": "*",
    ...(preflight
      ? {
          "Access-Control-Allow-Headers":
            "Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Max-Age": "86400",
        }
      : { "Access-Control-Expose-Headers": "mcp-session-id" }),
  });

  return {
    createMcpHandler:
      (server: McpServer, options: { route?: string } = {}) =>
      async (request: Request): Promise<Response> => {
        const route = options.route ?? "/mcp";
        if (new URL(request.url).pathname !== route) {
          return new Response("Not Found", { status: 404 });
        }

        const transport = new WebStandardStreamableHTTPServerTransport();
        await server.connect(transport);
        if (request.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders(true) });
        }

        const response = await transport.handleRequest(request);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(corsHeaders(false))) {
          headers.set(name, value);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
  };
});

import worker, {
  type AssetsBinding,
  type WorkerContext,
  type WorkerEnv,
} from "../src/worker.js";
import { DESIGNER_RESOURCE_URI } from "../src/server/types.js";

const DESIGNER_HTML =
  "<!doctype html><html><body>injected Worker designer</body></html>";
const MCP_PROTOCOL_VERSION = "2025-11-25";

type JsonRpcId = number | string | null;

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
}

function asJsonRpcMessages(value: unknown): JsonRpcMessage[] {
  return (Array.isArray(value) ? value : [value]) as JsonRpcMessage[];
}

async function parseMcpResponse(response: Response): Promise<JsonRpcMessage[]> {
  const body = await response.text();
  if (!body.trim()) return [];

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return asJsonRpcMessages(JSON.parse(body));
  }

  const messages: JsonRpcMessage[] = [];
  const eventBlocks = body.replaceAll("\r\n", "\n").split("\n\n");
  for (const block of eventBlocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data.trim()) {
      messages.push(...asJsonRpcMessages(JSON.parse(data)));
    }
  }

  // Some compatible handlers omit a content type while returning plain JSON.
  if (messages.length === 0) {
    return asJsonRpcMessages(JSON.parse(body));
  }
  return messages;
}

describe("Cloudflare Worker", () => {
  let assetFetch: ReturnType<typeof vi.fn>;
  let env: WorkerEnv;
  let ctx: WorkerContext;
  let requestId: number;

  beforeEach(() => {
    assetFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        const url = new URL(request.url);

        if (url.href === "https://assets.local/designer.html") {
          return new Response(DESIGNER_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        return new Response(`asset:${url.pathname}`, {
          headers: { "X-Asset-Response": "true" },
        });
      },
    );
    env = { ASSETS: { fetch: assetFetch } as AssetsBinding };
    ctx = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    };
    requestId = 1;
  });

  async function fetchWorker(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    return worker.fetch(
      new Request(`https://designer.example${path}`, init),
      env,
      ctx,
    );
  }

  async function callMcp(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ response: Response; message: JsonRpcMessage }> {
    const id = requestId++;
    const response = await fetchWorker("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const messages = await parseMcpResponse(response);
    const message = messages.find((candidate) => candidate.id === id);

    expect(response.status).toBe(200);
    expect(message, `missing JSON-RPC response ${id}`).toBeDefined();
    expect(message?.error).toBeUndefined();
    return { response, message: message! };
  }

  it("serves GET and HEAD health checks and rejects other methods", async () => {
    const getResponse = await fetchWorker("/health");
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    await expect(getResponse.json()).resolves.toEqual({
      ok: true,
      service: "openscad-designer",
    });

    const headResponse = await fetchWorker("/health", { method: "HEAD" });
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");

    const postResponse = await fetchWorker("/health", { method: "POST" });
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.get("allow")).toBe("GET, HEAD");
    await expect(postResponse.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("passes non-Worker routes through to the static asset binding", async () => {
    const response = await fetchWorker("/assets/designer.js?version=1");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-asset-response")).toBe("true");
    expect(await response.text()).toBe("asset:/assets/designer.js");
    expect(assetFetch).toHaveBeenCalledTimes(1);
    const request = assetFetch.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe(
      "https://designer.example/assets/designer.js?version=1",
    );
  });

  it("answers MCP CORS preflight without consulting static assets", async () => {
    const response = await fetchWorker("/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://chatgpt.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("mcp-protocol-version");
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("initializes a request-scoped MCP server", async () => {
    const { response, message } = await callMcp("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "worker-test", version: "1.0.0" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(message.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "openscad-designer", version: "0.1.0" },
    });
  });

  it("lists all four OpenSCAD design tools", async () => {
    const { message } = await callMcp("tools/list", {});
    const tools = message.result?.tools as Array<{ name: string }>;

    expect(tools.map(({ name }) => name)).toEqual([
      "open_design",
      "update_design",
      "configure_design",
      "export_design",
    ]);
  });

  it("reads the designer resource from the injected asset binding", async () => {
    const { message } = await callMcp("resources/read", {
      uri: DESIGNER_RESOURCE_URI,
    });
    const contents = message.result?.contents as Array<{
      uri: string;
      text: string;
    }>;

    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({
      uri: DESIGNER_RESOURCE_URI,
      text: DESIGNER_HTML,
    });
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch).toHaveBeenCalledWith(
      "https://assets.local/designer.html",
    );
  });

  it("returns a complete export request from export_design", async () => {
    const { message } = await callMcp("tools/call", {
      name: "export_design",
      arguments: {
        name: "wall-mount.scad",
        source: "cube(10);",
        values: {},
        format: "3mf",
      },
    });

    expect(message.result?.structuredContent).toEqual({
      action: "export",
      name: "wall-mount.scad",
      source: "cube(10);",
      values: {},
      export: { format: "3mf", fileName: "wall-mount.3mf" },
    });
  });
});
