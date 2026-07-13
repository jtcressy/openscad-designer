export const DESIGNER_RESOURCE_URI = "ui://openscad/designer.html";

export type ParameterValues = Record<string, unknown>;

/** A parsed OpenSCAD Customizer schema. Its shape is owned by the UI parser. */
export type ParameterSchema = unknown;

export type ExportFormat = "scad" | "stl" | "3mf";

export interface DesignState {
  name: string;
  source: string;
  values: ParameterValues;
  schema?: ParameterSchema;
  /** Optional caller-owned mesh/export artifact passed through without inspection. */
  geometry?: unknown;
  /** Optional caller-owned preview/render metadata passed through without inspection. */
  render?: unknown;
}

export interface DesignToolResult extends DesignState {
  [key: string]: unknown;
  action: "open" | "update" | "configure" | "export";
  export?: {
    format: ExportFormat;
    fileName: string;
  };
}
