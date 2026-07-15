import type { App } from "@modelcontextprotocol/ext-apps";

import type { GeometryOutput } from "./types.js";

type DownloadFileParams = Parameters<App["downloadFile"]>[0];
type DownloadFileResult = Awaited<ReturnType<App["downloadFile"]>>;

export interface ConnectedDownloadHost {
  /** Whether the host advertised `hostCapabilities.downloadFile`. */
  capabilityAdvertised: boolean;
  downloadFile: (params: DownloadFileParams) => Promise<DownloadFileResult>;
}

interface DownloadAnchor {
  href: string;
  download: string;
  rel: string;
  hidden: boolean;
  click(): void;
  remove(): void;
}

export interface BrowserDownloadEnvironment {
  createAnchor(): DownloadAnchor;
  appendAnchor(anchor: DownloadAnchor): void;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  setTimeout(callback: () => void, delay: number): unknown;
}

export interface DownloadGeometryOptions {
  /** Present only after the app has completed a host connection. */
  host?: ConnectedDownloadHost;
  browser?: BrowserDownloadEnvironment;
}

/**
 * Deliver generated geometry through the connected MCP host or a standalone
 * browser download. A connected widget never falls back to a synthetic anchor:
 * MCP App iframes can block those clicks without reporting an error.
 */
export async function downloadGeometry(
  output: GeometryOutput,
  fallbackName: string,
  options: DownloadGeometryOptions = {},
): Promise<void> {
  const fileName = output.fileName ?? fallbackName;
  const mimeType = output.mimeType ?? (output.format === "stl" ? "model/stl" : "model/3mf");

  if (options.host) {
    const params = await hostDownloadParams(output, fileName, mimeType);
    let result: DownloadFileResult;
    try {
      // A connected sandbox has no reliable anchor fallback. Attempting the
      // standard request also supports hosts with incomplete capability metadata
      // and gives us a real failure signal when the method is unavailable.
      result = await options.host.downloadFile(params);
    } catch (error) {
      const capabilityDetail = options.host.capabilityAdvertised
        ? ""
        : " The host did not advertise file-download support.";
      throw new Error(`The connected host could not download the file.${capabilityDetail}`, {
        cause: error,
      });
    }
    if (result.isError) throw new Error("The host declined the download.");
    return;
  }

  await downloadInStandaloneBrowser(
    output,
    fileName,
    mimeType,
    options.browser ?? defaultBrowserDownloadEnvironment(),
  );
}

async function hostDownloadParams(
  output: GeometryOutput,
  fileName: string,
  mimeType: string,
): Promise<DownloadFileParams> {
  if (isLinkedGeometry(output)) {
    return {
      contents: [{
        type: "resource_link",
        uri: output.url,
        name: fileName,
        mimeType,
      }],
    };
  }

  const buffer = await geometryToArrayBuffer(output);
  return {
    contents: [{
      type: "resource",
      resource: {
        uri: `file:///${encodeURIComponent(fileName)}`,
        mimeType,
        blob: arrayBufferToBase64(buffer),
      },
    }],
  };
}

async function downloadInStandaloneBrowser(
  output: GeometryOutput,
  fileName: string,
  mimeType: string,
  browser: BrowserDownloadEnvironment,
): Promise<void> {
  const anchor = browser.createAnchor();
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;

  let objectUrl: string | undefined;
  if (isLinkedGeometry(output)) {
    anchor.href = output.url;
  } else {
    const buffer = await geometryToArrayBuffer(output);
    objectUrl = browser.createObjectUrl(new Blob([buffer], { type: mimeType }));
    anchor.href = objectUrl;
  }

  browser.appendAnchor(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    if (objectUrl) {
      browser.setTimeout(() => browser.revokeObjectUrl(objectUrl), 1_000);
    }
  }
}

function isLinkedGeometry(
  output: GeometryOutput,
): output is GeometryOutput & { url: string } {
  return !!output.url && !output.buffer && !output.dataBase64 && !output.bytes;
}

function defaultBrowserDownloadEnvironment(): BrowserDownloadEnvironment {
  return {
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  };
}

export async function geometryToArrayBuffer(geometry: GeometryOutput): Promise<ArrayBuffer> {
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
