import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod/v4";

import { designerHtml } from "./generated/designer-html.js";
import {
  DESIGNER_RESOURCE_URI,
  type DesignToolResult,
  type ExportFormat,
  type ParameterValues,
} from "./types.js";

const DEFAULT_DESIGN_NAME = "design.scad";

const sourceField = z
  .string()
  .min(1)
  .describe("Complete OpenSCAD source for the current design.");
const nameField = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe("Human-readable design name, usually ending in .scad.");
const valuesField = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Current values keyed by OpenSCAD Customizer parameter name.");
const schemaField = z
  .unknown()
  .optional()
  .describe(
    "Optional Customizer parameter schema parsed by the caller. The server returns it unchanged.",
  );
const geometryField = z
  .unknown()
  .optional()
  .describe("Optional caller-owned geometry or mesh artifact to preserve.");
const renderField = z
  .unknown()
  .optional()
  .describe("Optional caller-owned render or preview metadata to preserve.");

const commonInputSchema = {
  source: sourceField,
  name: nameField,
  values: valuesField,
  schema: schemaField,
  geometry: geometryField,
  render: renderField,
};

const commonOutputSchema = {
  action: z.enum(["open", "update", "configure", "export"]),
  name: z.string(),
  source: z.string(),
  values: z.record(z.string(), z.unknown()),
  schema: z.unknown().optional(),
  geometry: z.unknown().optional(),
  render: z.unknown().optional(),
  export: z
    .object({
      format: z.enum(["scad", "stl", "3mf"]),
      fileName: z.string(),
    })
    .optional(),
};

const snapshotAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const exportAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const appToolMeta = (invoking: string, invoked: string) => ({
  ui: {
    resourceUri: DESIGNER_RESOURCE_URI,
    visibility: ["model", "app"] as Array<"model" | "app">,
  },
  // ChatGPT's original Apps SDK keys remain useful while hosts converge on
  // the MCP Apps nested metadata shape above.
  "openai/outputTemplate": DESIGNER_RESOURCE_URI,
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

function normalizeName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed || DEFAULT_DESIGN_NAME;
}

function stateResult(
  action: DesignToolResult["action"],
  input: {
    source: string;
    name?: string;
    values?: ParameterValues;
    schema?: unknown;
    geometry?: unknown;
    render?: unknown;
  },
  exportRequest?: DesignToolResult["export"],
): DesignToolResult {
  const result: DesignToolResult = {
    action,
    name: normalizeName(input.name),
    source: input.source,
    values: input.values ?? {},
  };

  if (input.schema !== undefined) result.schema = input.schema;
  if (input.geometry !== undefined) result.geometry = input.geometry;
  if (input.render !== undefined) result.render = input.render;
  if (exportRequest !== undefined) result.export = exportRequest;

  return result;
}

function toolResponse(result: DesignToolResult, message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: result,
  };
}

function defaultExportFileName(name: string, format: ExportFormat): string {
  const stem = name.replace(/\.(?:scad|stl|3mf)$/i, "") || "design";
  return `${stem}.${format}`;
}

/**
 * Create a fresh OpenSCAD Designer MCP server.
 *
 * The server deliberately stores no document state. Every mutating-looking tool
 * accepts and returns a complete design snapshot so it works behind stateless,
 * horizontally scaled Streamable HTTP endpoints.
 */
export function createOpenScadDesignerServer(): McpServer {
  const server = new McpServer({
    name: "openscad-designer",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "OpenSCAD Designer",
    DESIGNER_RESOURCE_URI,
    {
      description:
        "Interactive OpenSCAD source editor, Customizer controls, and 3D preview.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: [],
            resourceDomains: [],
          },
        },
        "openai/widgetDescription":
          "Edit a parameterized OpenSCAD design and inspect its 3D preview.",
        "openai/widgetPrefersBorder": true,
      },
    },
    async () => ({
      contents: [
        {
          uri: DESIGNER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: designerHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription":
              "Edit a parameterized OpenSCAD design and inspect its 3D preview.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "open_design",
    {
      title: "Open OpenSCAD design",
      description:
        "Open arbitrary OpenSCAD source in the interactive designer. Optionally include current Customizer values and a caller-parsed parameter schema.",
      inputSchema: commonInputSchema,
      outputSchema: commonOutputSchema,
      annotations: snapshotAnnotations,
      _meta: appToolMeta("Opening design…", "Design opened"),
    },
    async (input) => {
      const result = stateResult("open", input);
      return toolResponse(result, `Opened ${result.name} in OpenSCAD Designer.`);
    },
  );

  registerAppTool(
    server,
    "update_design",
    {
      title: "Update OpenSCAD design",
      description:
        "Replace the current design with a complete OpenSCAD source snapshot. Because the endpoint is stateless, include the latest values and parsed schema when they must be preserved.",
      inputSchema: commonInputSchema,
      outputSchema: commonOutputSchema,
      annotations: snapshotAnnotations,
      _meta: appToolMeta("Updating design…", "Design updated"),
    },
    async (input) => {
      const result = stateResult("update", input);
      return toolResponse(result, `Updated ${result.name}.`);
    },
  );

  registerAppTool(
    server,
    "configure_design",
    {
      title: "Configure OpenSCAD design",
      description:
        "Set OpenSCAD Customizer parameter values for a complete design snapshot. Include the current source because the endpoint keeps no server-side document state.",
      inputSchema: {
        ...commonInputSchema,
        values: z
          .record(z.string(), z.unknown())
          .describe("Complete current Customizer values keyed by parameter name."),
      },
      outputSchema: commonOutputSchema,
      annotations: snapshotAnnotations,
      _meta: appToolMeta("Applying parameters…", "Parameters applied"),
    },
    async (input) => {
      const result = stateResult("configure", input);
      return toolResponse(result, `Applied parameters to ${result.name}.`);
    },
  );

  registerAppTool(
    server,
    "export_design",
    {
      title: "Export OpenSCAD design",
      description:
        "Ask the designer UI to export the supplied complete design snapshot as OpenSCAD source, STL, or 3MF.",
      inputSchema: {
        ...commonInputSchema,
        format: z
          .enum(["scad", "stl", "3mf"])
          .describe("Requested download format."),
        fileName: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("Optional download name. A name is derived when omitted."),
      },
      outputSchema: commonOutputSchema,
      annotations: exportAnnotations,
      _meta: appToolMeta("Preparing export…", "Export ready"),
    },
    async (input) => {
      const name = normalizeName(input.name);
      const fileName =
        input.fileName?.trim() || defaultExportFileName(name, input.format);
      const result = stateResult("export", { ...input, name }, {
        format: input.format,
        fileName,
      });
      return toolResponse(
        result,
        `Requested ${input.format.toUpperCase()} export as ${fileName}.`,
      );
    },
  );

  return server;
}
