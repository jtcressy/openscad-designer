import { createMcpHandler } from "agents/mcp";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";

import { createOpenScadDesignerAppServer } from "./server/server.js";

export interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS: AssetsBinding;
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  readonly props: Record<string, unknown>;
}

interface WorkerModule {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: WorkerContext,
  ): Response | Promise<Response>;
}

const DESIGNER_ASSET_URL = "https://assets.local/designer.html";
const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();

async function loadDesignerHtml(assets: AssetsBinding): Promise<string> {
  const response = await assets.fetch(DESIGNER_ASSET_URL);
  if (!response.ok) {
    throw new Error(
      `The OpenSCAD Designer UI asset is unavailable (${response.status}).`,
    );
  }

  return response.text();
}

function healthResponse(method: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });

  if (method !== "GET" && method !== "HEAD") {
    headers.set("Allow", "GET, HEAD");
    return new Response(
      JSON.stringify({ error: "Method not allowed." }),
      { status: 405, headers },
    );
  }

  return new Response(
    method === "HEAD"
      ? null
      : JSON.stringify({ ok: true, service: "openscad-designer" }),
    { status: 200, headers },
  );
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return healthResponse(request.method);
    }

    if (pathname === "/mcp") {
      // MCP SDK >= 1.26 requires request-scoped server instances. This also
      // guarantees that design snapshots cannot leak between callers.
      const server = createOpenScadDesignerAppServer({
        loadDesignerHtml: () => loadDesignerHtml(env.ASSETS),
        serverOptions: { jsonSchemaValidator },
      });

      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies WorkerModule;
