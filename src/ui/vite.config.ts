import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [viteSingleFile()],
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
