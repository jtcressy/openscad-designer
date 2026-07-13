import { gzipSync } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerPath = path.join(root, "dist", "worker", "worker.js");
const assetsPath = path.join(root, "dist", "ui");
const maxWorkerGzipBytes = 3_000_000;
const maxAssetBytes = 25 * 1024 * 1024;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

const workerGzipBytes = gzipSync(await readFile(workerPath)).byteLength;
if (workerGzipBytes > maxWorkerGzipBytes) {
  throw new Error(
    `Worker bundle is ${workerGzipBytes} gzip bytes; limit is ${maxWorkerGzipBytes}.`,
  );
}

const assetFiles = await listFiles(assetsPath);
for (const assetPath of assetFiles) {
  const { size } = await stat(assetPath);
  if (size > maxAssetBytes) {
    throw new Error(
      `${path.relative(root, assetPath)} is ${size} bytes; limit is ${maxAssetBytes}.`,
    );
  }
}

console.log(
  `Cloudflare limits passed: Worker ${workerGzipBytes} gzip bytes; ${assetFiles.length} static asset(s) under 25 MiB.`,
);
