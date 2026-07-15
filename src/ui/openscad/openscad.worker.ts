import { renderOpenScadSource } from "./runtime.js";

interface RenderRequest {
  id: number;
  source: string;
  definitions: string;
}

interface RenderSuccess {
  id: number;
  ok: true;
  stl: ArrayBuffer;
  diagnostics: string[];
}

interface RenderFailure {
  id: number;
  ok: false;
  error: string;
  diagnostics: string[];
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { id, source, definitions } = event.data;
  const diagnostics: string[] = [];
  try {
    // OpenSCAD variables use last-assignment-wins semantics in a scope, so
    // appending validated Customizer assignments overrides model defaults.
    const effectiveSource = `${source}\n\n// OpenSCAD Designer parameter overrides\n${definitions}\n`;
    const result = await renderOpenScadSource(effectiveSource, {
      onDiagnostic: (line) => diagnostics.push(line),
    });
    const encoded = new TextEncoder().encode(result.stl);
    const stl = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    );
    const message: RenderSuccess = {
      id,
      ok: true,
      stl,
      diagnostics: diagnostics.slice(-40),
    };
    self.postMessage(message, { transfer: [stl] });
  } catch (error) {
    const message: RenderFailure = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: diagnostics.slice(-40),
    };
    self.postMessage(message);
  }
};
