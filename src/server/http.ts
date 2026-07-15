import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createOpenScadDesignerServer } from "./bundled-server.js";

export type StreamableHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody?: unknown,
) => Promise<void>;

export interface StreamableHttpHandlerOptions {
  /** Override the server factory in tests or to add deployment-specific tools. */
  createServer?: (request: IncomingMessage) => ReturnType<typeof createOpenScadDesignerServer>;
  /** Browser origin to permit. Defaults to `*`; authentication belongs upstream. */
  corsOrigin?: string;
}

function requestOrigin(request: IncomingMessage): string | undefined {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(",", 1)[0]?.trim();
  const host = request.headers.host;
  if (!host) return undefined;
  return `${protocol || "http"}://${host}`;
}

function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

/**
 * Build a request-scoped MCP Streamable HTTP handler.
 *
 * A new MCP server and transport are created for every POST, so no design or
 * protocol session state leaks between requests. GET and DELETE are rejected
 * because standalone SSE and session termination do not apply in this mode.
 */
export function createStreamableHttpHandler(
  options: StreamableHttpHandlerOptions = {},
): StreamableHttpHandler {
  const makeServer = options.createServer ?? ((request) =>
    createOpenScadDesignerServer(requestOrigin(request)));
  const corsOrigin = options.corsOrigin ?? "*";

  return async (request, response, parsedBody) => {
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS",
    );
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    );
    response.setHeader(
      "Access-Control-Expose-Headers",
      "Mcp-Protocol-Version, Mcp-Session-Id",
    );

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS");
      writeJsonRpcError(response, 405, -32000, "Method not allowed.");
      return;
    }

    const server = makeServer(request);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    let closed = false;

    const close = async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };

    response.once("close", () => {
      void close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      console.error("OpenSCAD Designer MCP request failed", error);
      writeJsonRpcError(response, 500, -32603, "Internal server error.");
    } finally {
      if (response.writableEnded) await close();
    }
  };
}

/** Default Node HTTP handler for deployments that need no customization. */
export const handleMcpRequest = createStreamableHttpHandler();
