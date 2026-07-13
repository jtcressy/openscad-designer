import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { designerHtml } from "./generated/designer-html.js";
import { createOpenScadDesignerAppServer } from "./server.js";

/**
 * Create the Node-hosted server with the generated single-file UI bundle.
 *
 * Cloudflare imports the runtime-neutral factory directly and loads this same
 * document through a Static Assets binding, keeping it out of the Worker
 * script.
 */
export function createOpenScadDesignerServer(): McpServer {
  return createOpenScadDesignerAppServer({
    loadDesignerHtml: () => designerHtml,
  });
}
