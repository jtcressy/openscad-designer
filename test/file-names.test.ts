import { describe, expect, it } from "vitest";

import { designFileName, safeFileName } from "../src/ui/file-names.js";

describe("design file names", () => {
  it("replaces an existing CAD extension instead of appending twice", () => {
    expect(designFileName("bracket.scad", "stl")).toBe("bracket.stl");
    expect(designFileName("part.STL", "3mf")).toBe("part.3mf");
  });

  it("sanitizes user-visible names and preserves a useful fallback", () => {
    expect(designFileName("Wall mount v2", "3mf")).toBe("Wall-mount-v2.3mf");
    expect(safeFileName("***")).toBe("openscad-model");
  });
});

