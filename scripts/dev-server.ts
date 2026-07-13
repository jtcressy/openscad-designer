import { createServer } from "node:http";

import { handleMcpRequest } from "../src/server/http.js";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "openscad-designer" }));
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
