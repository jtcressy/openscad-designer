import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOpenScadDesignerServer } from "../src/server/server.js";
import { DESIGNER_RESOURCE_URI } from "../src/server/types.js";

describe("OpenSCAD Designer MCP server", () => {
  const connections: Array<{ client: Client; server: ReturnType<typeof createOpenScadDesignerServer> }> = [];
  let client: Client;

  beforeEach(async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createOpenScadDesignerServer();
    client = new Client({ name: "server-test", version: "1.0.0" });
    connections.push({ client, server });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await Promise.all(
      connections.splice(0).flatMap(({ client: testClient, server }) => [
        testClient.close(),
        server.close(),
      ]),
    );
  });

  it("advertises four app-backed, snapshot-oriented tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      "open_design",
      "update_design",
      "configure_design",
      "export_design",
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool._meta).toMatchObject({
        ui: { resourceUri: DESIGNER_RESOURCE_URI },
        "openai/outputTemplate": DESIGNER_RESOURCE_URI,
      });
    }

    expect(tools.slice(0, 3).every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    expect(tools.at(3)?.annotations?.readOnlyHint).toBe(false);
  });

  it("serves the shared MCP App HTML resource", async () => {
    const result = await client.readResource({ uri: DESIGNER_RESOURCE_URI });

    expect(result.contents).toHaveLength(1);
    const content = result.contents.at(0)!;
    expect(content).toMatchObject({
      uri: DESIGNER_RESOURCE_URI,
      mimeType: "text/html;profile=mcp-app",
    });
    expect("text" in content && content.text).toContain(
      "OpenSCAD Designer",
    );
  });

  it("round-trips source, values, schema, and optional render artifacts", async () => {
    const schema = { parameters: [{ name: "width", type: "number" }] };
    const geometry = { kind: "stl", byteLength: 144 };
    const result = await client.callTool({
      name: "open_design",
      arguments: {
        name: "bracket.scad",
        source: "width = 20; cube([width, 4, 2]);",
        values: { width: 28 },
        schema,
        geometry,
        render: { camera: [10, 20, 30] },
      },
    });

    expect(result.structuredContent).toEqual({
      action: "open",
      name: "bracket.scad",
      source: "width = 20; cube([width, 4, 2]);",
      values: { width: 28 },
      schema,
      geometry,
      render: { camera: [10, 20, 30] },
    });
  });

  it("returns UI export request metadata without retaining server state", async () => {
    const result = await client.callTool({
      name: "export_design",
      arguments: {
        name: "wall-mount.scad",
        source: "cube(10);",
        values: {},
        format: "3mf",
      },
    });

    expect(result.structuredContent).toMatchObject({
      action: "export",
      name: "wall-mount.scad",
      source: "cube(10);",
      values: {},
      export: { format: "3mf", fileName: "wall-mount.3mf" },
    });
  });
});
