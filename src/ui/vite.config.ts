import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { DESIGNER_ASSET_ORIGIN_PLACEHOLDER } from "../shared/app-assets.js";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: `${DESIGNER_ASSET_ORIGIN_PLACEHOLDER}/`,
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    cssCodeSplit: false,
    target: "es2022",
    rollupOptions: {
      input: fileURLToPath(new URL("./designer.html", import.meta.url)),
    },
  },
  worker: {
    format: "es",
  },
});
