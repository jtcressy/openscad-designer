import { describe, expect, it } from "vitest";

import {
  parseOpenScadCustomizer,
  serializeOpenScadValue,
  toOpenScadDefinitions,
} from "../src/shared/customizer.js";

describe("parseOpenScadCustomizer", () => {
  it("parses ordered typed parameters, descriptions, groups, and controls", () => {
    const schema = parseOpenScadCustomizer(`
// Name engraved on the part
part_name = "Joel\\nCressy"; // ["Joel", "Justine", "A, B"]

/* [Dimensions] */
// Overall width in millimeters
width = 42.5; // [10:0.5:80]
height = 20; // [5:50]
enabled = true;
origin = [0, -1.5, 2];
quality = 2; // [1, 2, 4]
`);

    expect(schema.stoppedAtHidden).toBe(false);
    expect(schema.groups).toEqual([
      { name: "Dimensions", order: 0, hidden: false },
    ]);
    expect(schema.parameters.map(({ name, type, order }) => ({ name, type, order }))).toEqual([
      { name: "part_name", type: "string", order: 0 },
      { name: "width", type: "number", order: 1 },
      { name: "height", type: "number", order: 2 },
      { name: "enabled", type: "boolean", order: 3 },
      { name: "origin", type: "vector", order: 4 },
      { name: "quality", type: "number", order: 5 },
    ]);
    expect(schema.parameters[0]).toMatchObject({
      label: "Part name",
      description: "Name engraved on the part",
      value: "Joel\nCressy",
      control: { kind: "dropdown", options: ["Joel", "Justine", "A, B"] },
    });
    expect(schema.parameters[1]).toMatchObject({
      group: "Dimensions",
      description: "Overall width in millimeters",
      control: { kind: "range", min: 10, step: 0.5, max: 80 },
    });
    expect(schema.parameters[2]).toMatchObject({
      control: { kind: "range", min: 5, max: 50 },
    });
    expect(schema.parameters[4]).toMatchObject({ value: [0, -1.5, 2] });
    expect(schema.parameters[5]).toMatchObject({
      control: { kind: "dropdown", options: [1, 2, 4] },
    });
  });

  it("uses trailing prose as a description and ignores expression parameters", () => {
    const schema = parseOpenScadCustomizer(`
title = "demo"; // Friendly title
computed = 2 * 4;
inside = [true, "x", [1, 2]];
module example() { local_value = 5; }
`);

    expect(schema.parameters).toHaveLength(2);
    expect(schema.parameters[0]).toMatchObject({
      name: "title",
      description: "Friendly title",
    });
    expect(schema.parameters[1]).toMatchObject({
      name: "inside",
      value: [true, "x", [1, 2]],
    });
  });

  it("treats the Hidden section as a cutoff by default", () => {
    const source = `
visible = 1;
/* [Hidden] */
secret = "internal";
/* [Too Late] */
also_secret = false;
`;

    expect(parseOpenScadCustomizer(source)).toEqual({
      groups: [],
      parameters: [expect.objectContaining({ name: "visible", hidden: false })],
      stoppedAtHidden: true,
    });

    const included = parseOpenScadCustomizer(source, { includeHidden: true });
    expect(included.parameters.map(({ name, hidden }) => ({ name, hidden }))).toEqual([
      { name: "visible", hidden: false },
      { name: "secret", hidden: true },
      { name: "also_secret", hidden: true },
    ]);
    expect(included.groups).toEqual([
      { name: "Too Late", order: 0, hidden: true },
    ]);
  });

  it("does not mistake comment-like text in strings for annotations", () => {
    const schema = parseOpenScadCustomizer(`
url = "https://example.test/* [Nope] */";
/* [Real Group] */
text = "// still a string";
`);
    expect(schema.parameters.map((parameter) => parameter.group)).toEqual([
      undefined,
      "Real Group",
    ]);
  });

  it("ignores section markers and assignments nested in modules", () => {
    const schema = parseOpenScadCustomizer(`
module helper() {
  /* [Not a Customizer Group] */
  local = 4;
}
outside = 8;
`);

    expect(schema.groups).toEqual([]);
    expect(schema.parameters).toEqual([
      expect.objectContaining({ name: "outside" }),
    ]);
    expect(schema.parameters[0]?.group).toBeUndefined();
  });

  it("reports a terminal Hidden marker even when it has no declarations", () => {
    const schema = parseOpenScadCustomizer("visible = true;\n/* [Hidden] */\n");
    expect(schema.stoppedAtHidden).toBe(true);
    expect(schema.parameters).toHaveLength(1);
  });
});

describe("OpenSCAD definitions", () => {
  it("serializes values into argv-safe -D definitions in insertion order", () => {
    expect(
      toOpenScadDefinitions({
        label: 'a"b\\c\nnext',
        count: 3.5,
        enabled: false,
        offset: [1, -2, [true, "x"]],
      }),
    ).toEqual([
      'label="a\\"b\\\\c\\nnext"',
      "count=3.5",
      "enabled=false",
      'offset=[1, -2, [true, "x"]]',
    ]);
  });

  it("rejects invalid names and non-finite numbers", () => {
    expect(() => toOpenScadDefinitions({ "bad;name": 1 })).toThrow(
      "Invalid OpenSCAD variable name",
    );
    expect(() => serializeOpenScadValue(Number.POSITIVE_INFINITY)).toThrow(
      "must be finite",
    );
  });
});
