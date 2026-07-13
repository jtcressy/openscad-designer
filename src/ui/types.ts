import type { CustomizerSchema } from "../shared/customizer.js";

export type ParameterValue = string | number | boolean | null | ParameterValue[] | {
  [key: string]: ParameterValue;
};

export type DesignValues = Record<string, ParameterValue>;

/** A deliberately small JSON-Schema vocabulary plus UI hints used by the form. */
export interface ParameterSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: ParameterValue;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  enum?: Array<string | number | boolean>;
  enumNames?: string[];
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  items?: ParameterSchema;
  readOnly?: boolean;
  /** Form grouping hint, also accepted as `group`. */
  "x-group"?: string;
  group?: string;
  /** Supported values: slider, textarea, color, hidden. */
  "x-widget"?: string;
  /** Optional ordering hint for object properties. */
  "x-order"?: number;
}

export interface GeometryOutput {
  format: "stl" | "3mf";
  dataBase64?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  /** Non-JSON transports and local tests may provide binary values directly. */
  buffer?: ArrayBuffer | Uint8Array;
  bytes?: number[];
}

/**
 * structuredContent contract shared by `design` and `configure_design`.
 * The first four fields are also the complete, stateless configure tool input.
 */
export interface DesignerPayload {
  name: string;
  source: string;
  values: DesignValues;
  schema?: ParameterSchema | CustomizerSchema;
  geometry?: GeometryOutput;
  render?: {
    supported: boolean;
    reason?: string;
  };
  status?: string;
  error?: string;
  revision?: string | number;
  action?: "open" | "update" | "configure" | "export";
  export?: {
    format: "scad" | "stl" | "3mf";
    fileName: string;
  };
}

export interface ConfigureDesignInput {
  name: string;
  source: string;
  values: DesignValues;
  schema?: ParameterSchema | CustomizerSchema;
}

export function isDesignerPayload(value: unknown): value is DesignerPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesignerPayload>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.source === "string" &&
    !!candidate.values &&
    typeof candidate.values === "object" &&
    !Array.isArray(candidate.values)
  );
}

export function cloneValues(values: DesignValues): DesignValues {
  return typeof structuredClone === "function"
    ? structuredClone(values)
    : (JSON.parse(JSON.stringify(values)) as DesignValues);
}
