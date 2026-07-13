import { writeFile } from "node:fs/promises";

const target = new URL("../src/server/generated/designer-html.ts", import.meta.url);
const placeholder = `// Placeholder replaced by \`npm run inline:ui\` during the production build.
// Keeping this tiny avoids committing the roughly 12 MB generated app bundle.
export const designerHtml = \`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>OpenSCAD Designer</title></head>
  <body><p>Run <code>npm run build</code> to generate the OpenSCAD Designer app.</p></body>
</html>\`;
`;

await writeFile(target, placeholder, "utf8");
console.log("Restored the checked-in MCP App placeholder.");
