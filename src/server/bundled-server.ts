import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { designerHtml } from "./generated/designer-html.js";
import { createOpenScadDesignerAppServer } from "./server.js";

/**
 * Create the Node-hosted server with the generated lightweight UI shell.
 *
 * The shell references separately served scripts and styles so MCP hosts do
 * not have to ingest the large OpenSCAD runtime as part of resources/read.
 */
export function createOpenScadDesignerServer(assetOrigin?: string): McpServer {
  return createOpenScadDesignerAppServer({
    loadDesignerHtml: () => designerHtml,
    assetOrigin,
  });
}
