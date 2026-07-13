import { strToU8, zipSync } from "fflate";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const number = (value: number) => Number.isFinite(value) ? String(Number(value.toPrecision(9))) : "0";

/** Convert rendered STL geometry into a basic, slicer-compatible 3MF package. */
export function stlTo3mf(stl: ArrayBuffer, title = "OpenSCAD model"): Uint8Array {
  const geometry = new STLLoader().parse(stl);
  const positions = geometry.getAttribute("position");
  const vertices: string[] = [];
  const triangles: string[] = [];

  // STL is non-indexed. Keeping one vertex per corner is larger than a
  // deduplicated mesh but preserves the exact rendered triangle soup.
  for (let index = 0; index < positions.count; index += 1) {
    vertices.push(
      `<vertex x="${number(positions.getX(index))}" y="${number(positions.getY(index))}" z="${number(positions.getZ(index))}"/>`,
    );
  }
  for (let index = 0; index + 2 < positions.count; index += 3) {
    triangles.push(`<triangle v1="${index}" v2="${index + 1}" v3="${index + 2}"/>`);
  }

  const escapedTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapedTitle}</metadata>
  <metadata name="Application">OpenSCAD Designer</metadata>
  <resources><object id="1" type="model"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object></resources>
  <build><item objectid="1"/></build>
</model>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "3D/3dmodel.model": strToU8(model),
  }, { level: 6 });
}
