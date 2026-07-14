import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CustomizerSchema, OpenScadValue } from "../shared/customizer.js";
import { parseOpenScadCustomizer, toOpenScadDefinitions } from "../shared/customizer.js";
import { CadViewer, loadStlArrayBuffer } from "./cad-viewer.js";
import { designFileName } from "./file-names.js";
import { renderOpenScad, disposeOpenScadRenderer } from "./openscad/client.js";
import { stlTo3mf } from "./openscad/three-mf.js";
import { ParameterForm } from "./parameter-form.js";
import {
  previewStatusText,
  type PreviewStatusState,
} from "./preview-status.js";
import {
  cloneValues,
  isDesignerPayload,
  type ConfigureDesignInput,
  type DesignerPayload,
  type DesignValues,
  type GeometryOutput,
} from "./types.js";
import "./styles.css";

const elements = {
  shell: requireElement<HTMLElement>("app-shell"),
  designName: requireElement<HTMLElement>("design-name"),
  designRevision: requireElement<HTMLElement>("design-revision"),
  status: requireElement<HTMLElement>("status"),
  statusText: requireElement<HTMLElement>("status-text"),
  error: requireElement<HTMLElement>("error"),
  viewer: requireElement<HTMLElement>("viewer"),
  previewEmpty: requireElement<HTMLElement>("preview-empty"),
  previewStatusText: requireElement<HTMLElement>("preview-status-text"),
  parameterForm: requireElement<HTMLFormElement>("parameter-form"),
  previewTab: requireElement<HTMLButtonElement>("preview-tab"),
  codeTab: requireElement<HTMLButtonElement>("code-tab"),
  previewPanel: requireElement<HTMLElement>("preview-panel"),
  codePanel: requireElement<HTMLElement>("code-panel"),
  source: requireElement<HTMLTextAreaElement>("source-code"),
  codeState: requireElement<HTMLElement>("code-state"),
  applySource: requireElement<HTMLButtonElement>("apply-source"),
  resetView: requireElement<HTMLButtonElement>("reset-view"),
  fullscreen: requireElement<HTMLButtonElement>("fullscreen"),
  exportStl: requireElement<HTMLButtonElement>("export-stl"),
  export3mf: requireElement<HTMLButtonElement>("export-3mf"),
};

const app = new App(
  { name: "openscad-designer", version: "0.1.0" },
  {},
  { autoResize: true },
);
type HostContext = NonNullable<ReturnType<typeof app.getHostContext>>;
const viewer = new CadViewer(elements.viewer);
const outputs = new Map<"stl" | "3mf", GeometryOutput>();
let current: DesignerPayload | undefined;
let connected = false;
let sourceDirty = false;
let configureTimer: number | undefined;
let renderTimer: number | undefined;
let renderGeneration = 0;
let lastRenderSignature = "";
let lastStl: ArrayBuffer | undefined;
let disposed = false;
let previewState: PreviewStatusState = {
  hasGeometry: false,
  rendering: false,
};

const parameters = new ParameterForm(elements.parameterForm, (values) => {
  if (!current) return;
  current = { ...current, values };
  invalidateGeometry();
  scheduleDesignUpdate();
});

app.addEventListener("toolinput", ({ arguments: input }) => {
  if (isDesignerPayload(input)) consumePayload(input, { render: true });
});
app.addEventListener("toolresult", (result) => {
  void consumeToolResult(result);
});
app.addEventListener("toolcancelled", ({ reason }) => {
  setStatus(reason ? `Cancelled: ${reason}` : "Tool call cancelled", "error");
});
app.addEventListener("hostcontextchanged", (context) => applyHostContext(context));
app.onteardown = async () => {
  window.clearTimeout(configureTimer);
  window.clearTimeout(renderTimer);
  if (current && connected) await configureDesign();
  cleanupApp();
  return {};
};

elements.previewTab.addEventListener("click", () => selectTab("preview"));
elements.codeTab.addEventListener("click", () => selectTab("code"));
elements.resetView.addEventListener("click", () => viewer.resetView());
elements.fullscreen.addEventListener("click", () => void toggleFullscreen());
elements.exportStl.addEventListener("click", () => void requestExport("stl"));
elements.export3mf.addEventListener("click", () => void requestExport("3mf"));
elements.applySource.addEventListener("click", applySource);
elements.source.addEventListener("input", () => {
  sourceDirty = current?.source !== elements.source.value;
  elements.applySource.disabled = !sourceDirty || !current;
  elements.codeState.textContent = sourceDirty ? "Source has unapplied changes" : "Source is synchronized";
});
elements.source.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    applySource();
  }
});

window.addEventListener("pagehide", () => {
  window.clearTimeout(configureTimer);
  window.clearTimeout(renderTimer);
  cleanupApp();
});

void connect();

async function connect(): Promise<void> {
  try {
    await app.connect();
    connected = true;
    elements.shell.setAttribute("aria-busy", "false");
    applyHostContext(app.getHostContext());
    setStatus("Ready", "ready");
  } catch (error) {
    // Keeping the renderer usable makes `vite dev` a useful standalone UI harness.
    elements.shell.setAttribute("aria-busy", "false");
    showError(`The MCP host connection failed. ${errorMessage(error)}`);
    setStatus("Standalone preview", "error");
  }
}

function consumePayload(payload: DesignerPayload, options: { render: boolean }): void {
  const schema = payload.schema ?? parseOpenScadCustomizer(payload.source);
  const values = withCustomizerDefaults(payload.values, schema);
  const previousSignature = current ? designSignature(current.name, current.source, current.values) : undefined;
  const incomingSignature = designSignature(payload.name, payload.source, values);
  if (previousSignature !== undefined && previousSignature !== incomingSignature) invalidateGeometry();
  current = {
    ...payload,
    schema,
    values,
  };
  elements.designName.textContent = payload.name || "Untitled design";
  elements.designRevision.textContent = payload.revision === undefined
    ? "Parameterized OpenSCAD model"
    : `Revision ${payload.revision}`;
  if (!sourceDirty || elements.source.value === payload.source) {
    elements.source.value = payload.source;
    sourceDirty = false;
    elements.applySource.disabled = true;
    elements.codeState.textContent = "Source is synchronized";
  }
  parameters.render(schema, values);
  elements.exportStl.disabled = payload.render?.supported === false;
  elements.export3mf.disabled = payload.render?.supported === false;
  hideError();

  if (payload.error) showError(payload.error);
  if (payload.status) setStatus(payload.status, payload.error ? "error" : "ready");
  if (payload.render?.supported === false) {
    viewer.clear();
    setPreviewState({ hasGeometry: false, rendering: false });
    showError(payload.render.reason ?? "This model cannot be rendered in the browser.");
    return;
  }

  if (payload.geometry) {
    outputs.set(payload.geometry.format, payload.geometry);
    if (payload.geometry.format === "stl") void displayGeometry(payload.geometry);
  } else if (options.render && !payload.export) {
    scheduleLocalRender(0);
  }
  if (payload.export) {
    window.setTimeout(() => void fulfillExportRequest(payload.export!), 0);
  }
}

async function consumeToolResult(result: ToolResultLike): Promise<DesignerPayload | undefined> {
  if (result.isError) {
    const detail = extractToolText(result) || "The design tool returned an error.";
    showError(detail);
    setStatus("Render failed", "error");
    return undefined;
  }
  const payload = result.structuredContent;
  if (!isDesignerPayload(payload)) {
    const detail = extractToolText(result);
    if (detail) setStatus(detail, "ready");
    return undefined;
  }
  consumePayload(payload, { render: true });
  return payload;
}

function scheduleDesignUpdate(): void {
  window.clearTimeout(configureTimer);
  window.clearTimeout(renderTimer);
  setStatus("Waiting for changes…", "busy");
  renderTimer = window.setTimeout(() => void renderLocally(), 180);
  configureTimer = window.setTimeout(() => void configureDesign(), 380);
}

function scheduleLocalRender(delay = 180): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => void renderLocally(), delay);
}

async function configureDesign(): Promise<DesignerPayload | undefined> {
  if (!current || !connected) return undefined;
  const input: ConfigureDesignInput = {
    name: current.name,
    source: current.source,
    schema: current.schema,
    values: cloneValues(current.values),
  };
  try {
    const result = await app.callServerTool({ name: "configure_design", arguments: { ...input } });
    const payload = await consumeToolResult(result);
    if (payload) {
      void app.updateModelContext({
        structuredContent: {
          design: {
            name: payload.name,
            source: payload.source,
            schema: payload.schema,
            values: payload.values,
            revision: payload.revision,
          },
        },
      }).catch(() => undefined);
    }
    return payload;
  } catch (error) {
    // Local WASM rendering can still satisfy interactive edits if the server call fails.
    showError(`Could not synchronize the design: ${errorMessage(error)}`);
    return undefined;
  }
}

async function renderLocally(): Promise<void> {
  if (!current || current.render?.supported === false) return;
  const signature = designSignature(current.name, current.source, current.values);
  if (signature === lastRenderSignature && lastStl) {
    setPreviewState({ hasGeometry: true, rendering: false });
    setStatus("Ready", "ready");
    return;
  }

  const generation = ++renderGeneration;
  setPreviewState({
    hasGeometry: previewState.hasGeometry,
    rendering: true,
  });
  setStatus("Rendering OpenSCAD…", "busy");
  try {
    const values = toRenderableValues(current.values);
    const definitions = toOpenScadDefinitions(values).map((definition) => `${definition};`).join("\n");
    const result = await renderOpenScad({ source: current.source, definitions });
    if (generation !== renderGeneration) return;
    lastRenderSignature = signature;
    lastStl = result.stl;
    outputs.set("stl", {
      format: "stl",
      buffer: result.stl,
      fileName: designFileName(current.name, "stl"),
      mimeType: "model/stl",
    });
    outputs.delete("3mf");
    loadStlArrayBuffer(viewer, result.stl);
    setPreviewState({ hasGeometry: true, rendering: false });
    hideError();
    setStatus(result.diagnostics.length ? "Rendered with diagnostics" : "Ready", "ready");
  } catch (error) {
    if (generation !== renderGeneration || error instanceof DOMException && error.name === "AbortError") return;
    setPreviewState({
      hasGeometry: previewState.hasGeometry,
      rendering: false,
    });
    showError(errorMessage(error));
    setStatus("Render failed", "error");
  }
}

async function displayGeometry(geometry: GeometryOutput): Promise<void> {
  try {
    const buffer = await geometryToArrayBuffer(geometry);
    lastStl = buffer;
    outputs.delete("3mf");
    loadStlArrayBuffer(viewer, buffer);
    setPreviewState({ hasGeometry: true, rendering: false });
    setStatus("Ready", "ready");
  } catch (error) {
    setPreviewState({
      hasGeometry: previewState.hasGeometry,
      rendering: false,
    });
    showError(`Could not load the STL preview: ${errorMessage(error)}`);
  }
}

async function requestExport(format: "stl" | "3mf", requestedFileName?: string): Promise<void> {
  if (!current) return;
  const fileName = requestedFileName ?? designFileName(current.name, format);
  setStatus(`Preparing ${format.toUpperCase()}…`, "busy");
  try {
    let output = outputs.get(format);
    if (!output && !lastStl && current.render?.supported !== false) {
      lastRenderSignature = "";
      await renderLocally();
    }
    if (!output && lastStl) {
      output = format === "stl"
        ? { format, buffer: lastStl, fileName, mimeType: "model/stl" }
        : {
            format,
            buffer: stlTo3mf(lastStl, current.name),
            fileName,
            mimeType: "model/3mf",
          };
      outputs.set(format, output);
    }
    if (!output) {
      output = await requestServerExport(format, fileName);
    }
    if (!output) throw new Error(`No ${format.toUpperCase()} output was returned.`);
    await downloadGeometry(output, fileName);
    setStatus(`${format.toUpperCase()} ready`, "ready");
  } catch (error) {
    showError(`Export failed: ${errorMessage(error)}`);
    setStatus("Export failed", "error");
  }
}

async function requestServerExport(
  format: "stl" | "3mf",
  fileName: string,
): Promise<GeometryOutput | undefined> {
  if (!current || !connected) return undefined;
  const result = await app.callServerTool({
    name: "export_design",
    arguments: {
      name: current.name,
      source: current.source,
      schema: current.schema,
      values: cloneValues(current.values),
      format,
      fileName,
    },
  });
  if (result.isError) throw new Error(extractToolText(result) || "The export tool returned an error.");
  const payload = result.structuredContent;
  if (!isDesignerPayload(payload) || payload.geometry?.format !== format) return undefined;
  outputs.set(format, payload.geometry);
  return payload.geometry;
}

async function fulfillExportRequest(request: NonNullable<DesignerPayload["export"]>): Promise<void> {
  if (!current) return;
  if (request.format === "scad") {
    const bytes = new TextEncoder().encode(current.source);
    await downloadGeometry(
      { format: "stl", buffer: bytes, fileName: request.fileName, mimeType: "text/plain" },
      request.fileName,
    );
    setStatus("SCAD ready", "ready");
    return;
  }
  await requestExport(request.format, request.fileName);
}

async function downloadGeometry(output: GeometryOutput, fallbackName: string): Promise<void> {
  const fileName = output.fileName ?? fallbackName;
  const mimeType = output.mimeType ?? (output.format === "stl" ? "model/stl" : "model/3mf");
  if (connected && app.getHostCapabilities()?.downloadFile) {
    if (output.url && !output.buffer && !output.dataBase64 && !output.bytes) {
      const result = await app.downloadFile({
        contents: [{
          type: "resource_link",
          uri: output.url,
          name: fileName,
          mimeType,
        }],
      });
      if (result.isError) throw new Error("The host declined the download.");
      return;
    }
    const buffer = await geometryToArrayBuffer(output);
    const result = await app.downloadFile({
      contents: [{
        type: "resource",
        resource: {
          uri: `file:///${fileName}`,
          mimeType,
          blob: arrayBufferToBase64(buffer),
        },
      }],
    });
    if (result.isError) throw new Error("The host declined the download.");
    return;
  }

  if (output.url && !output.buffer && !output.dataBase64 && !output.bytes) {
    const anchor = document.createElement("a");
    anchor.href = output.url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.click();
    return;
  }
  const buffer = await geometryToArrayBuffer(output);
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function applySource(): void {
  if (!current || !sourceDirty) return;
  const source = elements.source.value;
  const schema = parseOpenScadCustomizer(source);
  const values = withCustomizerDefaults(current.values, schema);
  current = { ...current, source, schema, values };
  invalidateGeometry();
  parameters.render(schema, values);
  sourceDirty = false;
  elements.applySource.disabled = true;
  elements.codeState.textContent = "Applying source…";
  lastRenderSignature = "";
  scheduleDesignUpdate();
}

function selectTab(tab: "preview" | "code"): void {
  const preview = tab === "preview";
  elements.previewTab.classList.toggle("active", preview);
  elements.codeTab.classList.toggle("active", !preview);
  elements.previewTab.setAttribute("aria-selected", String(preview));
  elements.codeTab.setAttribute("aria-selected", String(!preview));
  elements.previewPanel.hidden = !preview;
  elements.codePanel.hidden = preview;
}

async function toggleFullscreen(): Promise<void> {
  const context = app.getHostContext();
  const next = context?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    const result = await app.requestDisplayMode({ mode: next });
    document.documentElement.dataset.displayMode = result.mode;
    elements.fullscreen.textContent = result.mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
  } catch (error) {
    showError(`Could not change display mode: ${errorMessage(error)}`);
  }
}

function applyHostContext(context: HostContext | undefined): void {
  if (!context) return;
  if (context.theme) {
    applyDocumentTheme(context.theme);
    viewer.setTheme(context.theme);
  }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  if (context.displayMode) {
    document.documentElement.dataset.displayMode = context.displayMode;
    elements.fullscreen.textContent = context.displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
  }
  const modes = context.availableDisplayModes;
  if (modes) elements.fullscreen.hidden = !modes.includes("fullscreen");
}

async function geometryToArrayBuffer(geometry: GeometryOutput): Promise<ArrayBuffer> {
  if (geometry.buffer instanceof ArrayBuffer) return geometry.buffer.slice(0);
  if (geometry.buffer instanceof Uint8Array) return uint8ToArrayBuffer(geometry.buffer);
  if (geometry.bytes) return Uint8Array.from(geometry.bytes).buffer;
  if (geometry.dataBase64) return base64ToArrayBuffer(geometry.dataBase64);
  if (geometry.url) {
    const response = await fetch(geometry.url);
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status}.`);
    return response.arrayBuffer();
  }
  throw new Error("Geometry did not include a URL or binary payload.");
}

function base64ToArrayBuffer(input: string): ArrayBuffer {
  const encoded = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
  const binary = atob(encoded.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toRenderableValues(values: DesignValues): Record<string, OpenScadValue> {
  const result: Record<string, OpenScadValue> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!isOpenScadValue(value)) throw new TypeError(`Parameter “${name}” is not an OpenSCAD literal.`);
    result[name] = value;
  }
  return result;
}

function withCustomizerDefaults(
  values: DesignValues,
  schema: DesignerPayload["schema"],
): DesignValues {
  const result = cloneValues(values);
  if (!schema || !("parameters" in schema)) return result;
  for (const parameter of (schema as CustomizerSchema).parameters) {
    if (!(parameter.name in result)) result[parameter.name] = parameter.value;
  }
  return result;
}

function designSignature(name: string, source: string, values: DesignValues): string {
  return `${name}\u0000${source}\u0000${JSON.stringify(values)}`;
}

function invalidateGeometry(): void {
  renderGeneration += 1;
  disposeOpenScadRenderer();
  outputs.clear();
  lastStl = undefined;
  lastRenderSignature = "";
  viewer.clear();
  setPreviewState({ hasGeometry: false, rendering: false });
}

function cleanupApp(): void {
  if (disposed) return;
  disposed = true;
  disposeOpenScadRenderer();
  viewer.dispose();
}

function isOpenScadValue(value: unknown): value is OpenScadValue {
  return (
    typeof value === "string" ||
    typeof value === "number" && Number.isFinite(value) ||
    typeof value === "boolean" ||
    Array.isArray(value) && value.every(isOpenScadValue)
  );
}

function setStatus(message: string, state: "ready" | "busy" | "error"): void {
  elements.statusText.textContent = message;
  elements.status.classList.toggle("busy", state === "busy");
  elements.status.classList.toggle("error", state === "error");
}

function setPreviewState(state: PreviewStatusState): void {
  previewState = state;
  const message = previewStatusText(state);
  elements.previewStatusText.textContent = message;
  elements.previewEmpty.hidden = message.length === 0;
  elements.previewEmpty.setAttribute(
    "aria-busy",
    String(state.rendering && !state.hasGeometry),
  );
}

function showError(message: string): void {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function hideError(): void {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractToolText(result: ToolResultLike): string {
  return result.content
    ?.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n") ?? "";
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}

interface ToolResultLike {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}
