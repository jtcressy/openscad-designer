import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { stlTo3mf } from "../src/ui/openscad/three-mf.js";

const triangleStl = new TextEncoder().encode(`solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid triangle`).buffer;

describe("stlTo3mf", () => {
  it("packages STL triangles as a minimal 3MF model", () => {
    const archive = unzipSync(stlTo3mf(triangleStl, "Fixture"));
    expect(Object.keys(archive).sort()).toEqual([
      "3D/3dmodel.model",
      "[Content_Types].xml",
      "_rels/.rels",
    ]);
    const model = strFromU8(archive["3D/3dmodel.model"]!);
    expect(model).toContain('<metadata name="Title">Fixture</metadata>');
    expect(model.match(/<vertex /g)).toHaveLength(3);
    expect(model).toContain('<triangle v1="0" v2="1" v3="2"/>');
  });
});
