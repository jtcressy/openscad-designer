import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { handleMcpRequest } from "../src/server/http.js";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
const uiRoot = path.resolve(fileURLToPath(new URL("../ui/", import.meta.url)));

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

async function serveUiAsset(pathname: string, response: ServerResponse) {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const filePath = path.resolve(uiRoot, `.${decodedPath}`);
  if (!filePath.startsWith(`${uiRoot}${path.sep}`)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Length": fileStat.size,
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "openscad-designer" }));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    await serveUiAsset(url.pathname, response);
    return;
  }
  if (url.pathname !== "/mcp") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  await handleMcpRequest(request, response);
});

server.listen(port, host, () => {
  console.log(`OpenSCAD Designer MCP listening at http://${host}:${port}/mcp`);
});
