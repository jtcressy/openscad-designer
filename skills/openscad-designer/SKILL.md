---
name: openscad-designer
description: Create and iteratively refine parametric OpenSCAD models with an interactive Customizer form, faithful STL preview, and STL or 3MF export.
---

# OpenSCAD Designer

Use the OpenSCAD Designer tools for requests to create, inspect, parameterize, preview, or export an OpenSCAD model.

1. Prefer a readable parametric `.scad` document over hard-coded mesh data.
2. Put user-facing parameters before `/* [Hidden] */` and annotate them using OpenSCAD Customizer syntax.
3. Use millimeters unless the user explicitly requests another unit.
4. Preserve the complete source and current parameter values on every stateless update.
5. After a structural source change, render and inspect the model before claiming it is printable.
6. Treat slicer settings and G-code generation as downstream work; this app produces design geometry.

For a new model, call `open_design`. For source edits, call `update_design`. For parameter-only changes, call `configure_design`. Use `export_design` only after the preview is valid.
