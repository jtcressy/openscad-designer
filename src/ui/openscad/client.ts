import OpenScadWorker from "./openscad.worker.ts?worker&inline";

export interface OpenScadRender {
  stl: ArrayBuffer;
  diagnostics: string[];
}

export interface OpenScadRenderOptions {
  source: string;
  definitions?: string;
  signal?: AbortSignal;
}

let nextId = 0;
let activeWorker: Worker | undefined;
let cancelActiveRender: (() => void) | undefined;

/** Render with a fresh OpenSCAD runtime; Emscripten exits after each call. */
export function renderOpenScad({
  source,
  definitions = "",
  signal,
}: OpenScadRenderOptions): Promise<OpenScadRender> {
  disposeOpenScadRenderer();
  const worker = new OpenScadWorker();
  activeWorker = worker;
  const id = ++nextId;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (activeWorker === worker) activeWorker = undefined;
      if (cancelActiveRender === abort) cancelActiveRender = undefined;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("OpenSCAD render cancelled", "AbortError"));
    cancelActiveRender = abort;
    signal?.addEventListener("abort", abort, { once: true });

    worker.onerror = (event) => {
      fail(new Error(event.message || "OpenSCAD worker failed"));
    };
    worker.onmessage = (event: MessageEvent<{
      id: number;
      ok: boolean;
      stl?: ArrayBuffer;
      error?: string;
      diagnostics?: string[];
    }>) => {
      if (event.data.id !== id) return;
      if (!event.data.ok || !event.data.stl) {
        const detail = event.data.diagnostics?.slice(-8).join("\n");
        fail(new Error([event.data.error || "OpenSCAD render failed", detail].filter(Boolean).join("\n")));
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stl: event.data.stl,
        diagnostics: event.data.diagnostics ?? [],
      });
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.postMessage({ id, source, definitions });
  });
}

export function disposeOpenScadRenderer(): void {
  cancelActiveRender?.();
}
