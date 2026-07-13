import { createOpenSCAD } from "openscad-wasm-prebuilt";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { describe, expect, it } from "vitest";

import {
  parseOpenScadCustomizer,
  toOpenScadDefinitions,
} from "../src/shared/customizer.js";

describe("OpenSCAD WASM render path", () => {
  it("renders the actual mesh with Customizer overrides", async () => {
    const source = `/* [Size] */
width = 10; // [5:1:40]
depth = 3;
height = 4;
cube([width, depth, height]);`;
    const schema = parseOpenScadCustomizer(source);
    expect(schema.parameters.map(({ name }) => name)).toEqual([
      "width",
      "depth",
      "height",
    ]);

    const definitions = toOpenScadDefinitions({ width: 20 })
      .map((definition) => `${definition};`)
      .join("\n");
    const openscad = await createOpenSCAD({ printErr: () => undefined });
    const stl = await openscad.renderToStl(`${source}\n${definitions}`);
    const bytes = new TextEncoder().encode(stl);
    const geometry = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;

    expect(bounds.max.x - bounds.min.x).toBeCloseTo(20, 4);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(3, 4);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(4, 4);
  });
});
