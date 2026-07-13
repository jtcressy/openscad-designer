import { createOpenSCAD } from "openscad-wasm-prebuilt";

export type OpenScadBackend = "Manifold" | "CGAL";

export interface OpenScadRuntimeResult {
  stl: string;
  backend: OpenScadBackend;
}

export interface OpenScadRuntimeOptions {
  onDiagnostic?: (line: string) => void;
}

async function renderWithBackend(
  source: string,
  backend: OpenScadBackend,
  onDiagnostic: (line: string) => void,
): Promise<string> {
  const openscad = await createOpenSCAD({
    print: onDiagnostic,
    printErr: onDiagnostic,
  });
  const instance = openscad.getInstance();
  const inputPath = "/input.scad";
  const outputPath = "/output.stl";

  try {
    instance.FS.writeFile(inputPath, source);
    const exitCode = instance.callMain([
      inputPath,
      `--backend=${backend}`,
      "-o",
      outputPath,
    ]);
    if (exitCode !== 0) {
      throw new Error(`OpenSCAD ${backend} backend exited with code ${exitCode}.`);
    }
    return instance.FS.readFile(outputPath, { encoding: "utf8" });
  } finally {
    for (const path of [inputPath, outputPath]) {
      try {
        instance.FS.unlink(path);
      } catch {
        // A failed render may not create its output file.
      }
    }
  }
}

/**
 * Render with OpenSCAD's substantially faster Manifold backend, falling back
 * to legacy CGAL for models the newer backend cannot evaluate.
 */
export async function renderOpenScadSource(
  source: string,
  options: OpenScadRuntimeOptions = {},
): Promise<OpenScadRuntimeResult> {
  const onDiagnostic = options.onDiagnostic ?? (() => undefined);

  try {
    return {
      stl: await renderWithBackend(source, "Manifold", onDiagnostic),
      backend: "Manifold",
    };
  } catch (manifoldError) {
    onDiagnostic(
      `Manifold backend failed; retrying with CGAL: ${
        manifoldError instanceof Error ? manifoldError.message : String(manifoldError)
      }`,
    );
    return {
      stl: await renderWithBackend(source, "CGAL", onDiagnostic),
      backend: "CGAL",
    };
  }
}
