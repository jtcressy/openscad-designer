import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * OpenAI Apps SDK authentication metadata for a tool that is always public.
 *
 * Keep this as one shared value so the canonical descriptor field and its
 * `_meta` compatibility mirror cannot drift apart.
 */
export const NO_AUTH_SECURITY_SCHEMES = [{ type: "noauth" }] as const;

type InternalRequestHandler = (
  request: unknown,
  extra: unknown,
) => unknown | Promise<unknown>;

function requestHandlers(server: McpServer): Map<string, InternalRequestHandler> {
  // The current MCP TypeScript SDK does not retain the Apps SDK's canonical
  // top-level `securitySchemes` extension when McpServer builds tools/list.
  // Preserve the SDK's own handler and decorate its result until the SDK adds
  // first-class support. The raw HTTP contract is covered by Worker tests.
  const handlers = Reflect.get(server.server, "_requestHandlers");
  if (!(handlers instanceof Map)) {
    throw new Error("Unable to access the MCP request-handler registry.");
  }

  return handlers as Map<string, InternalRequestHandler>;
}

/**
 * Explicitly advertise every registered tool as anonymously callable.
 *
 * OpenAI requires the canonical `securitySchemes` descriptor field and keeps
 * `_meta.securitySchemes` as a compatibility mirror for older clients.
 */
export function advertiseNoAuthToolSecurity(server: McpServer): void {
  const handlers = requestHandlers(server);
  const listTools = handlers.get("tools/list");
  if (!listTools) {
    throw new Error("Cannot advertise tool security before registering tools.");
  }

  server.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request, extra) => {
      const originalResult = await listTools(request, extra);
      if (
        typeof originalResult !== "object" ||
        originalResult === null ||
        !("tools" in originalResult) ||
        !Array.isArray(originalResult.tools)
      ) {
        throw new Error("The MCP tools/list handler returned an invalid result.");
      }

      const result = originalResult as ListToolsResult;
      return {
        ...result,
        tools: result.tools.map((tool) => ({
          ...tool,
          securitySchemes: NO_AUTH_SECURITY_SCHEMES,
          _meta: {
            ...(tool._meta ?? {}),
            securitySchemes: NO_AUTH_SECURITY_SCHEMES,
          },
        })),
      } as ListToolsResult;
    },
  );
}
