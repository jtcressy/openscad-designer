# OpenSCAD Designer architecture

Status: draft architecture for the browser-rendered MVP and its first hosted deployment.

## Executive summary

OpenSCAD Designer is intentionally a browser-rendered ChatGPT app, not a hosted CAD service. ChatGPT talks to a small MCP control plane. The control plane advertises tools, validates complete design snapshots, and serves the app resource. Each mounted app iframe owns its source, parameter values, rendered mesh, and OpenSCAD WebAssembly worker.

ChatGPT supplies the intelligence and model runtime. Our deployment does not call the OpenAI API and does not need an OpenAI API key. Cloudflare supplies only the protocol and asset edge; the user’s browser supplies CAD compute.

This architecture supports many independent users once it is deployed: every user receives an isolated iframe and every MCP request receives a fresh stateless server instance. Shared documents, membership, permissions, presence, and real-time co-editing are explicitly outside the product scope. Personal persistence is not currently implemented and would not change that boundary.

| Meaning of “multi-user” | Current position |
| --- | --- |
| Many people independently use the public app | Architectural target; requires deployment and load testing |
| Two people edit the same design together | Explicitly out of scope |
| A person returns to saved projects later | Not implemented; files are currently downloaded by the user |

## Runtime overview

```mermaid
flowchart TD
    U["User"] --> H["ChatGPT host"]
    H -->|"MCP requests over /mcp"| M["Stateless MCP control plane"]
    M -->|"tools + app resource + snapshots"| H
    H -->|"mount per invocation"| I["Isolated designer iframe"]
    I --> P["Customizer parser + controls"]
    I --> W["Browser Web Worker: OpenSCAD WASM"]
    W -->|"STL mesh"| V["Three.js preview + STL/3MF export"]
    I -->|"current source + values"| H
    A["Cloudflare static assets"] -.->|"planned packaging"| M
    A -.->|"planned JS + WASM assets"| I
```

The dashed Cloudflare edge is a packaging change, not a change in where CAD computation runs. The first hosted version should keep OpenSCAD inside the browser unless a live ChatGPT sandbox test proves that impossible.

## Component responsibilities

### ChatGPT host

- Uses the model to create and revise OpenSCAD source.
- Discovers and calls tools exposed by the remote MCP endpoint.
- Fetches and mounts the associated MCP App resource in an iframe.
- Receives `ui/update-model-context` snapshots after the user edits source or parameters.
- Mediates supported file-download and display-mode operations.

### MCP control plane

The MCP server is the protocol adapter between ChatGPT and the frontend. A standalone browser application would not need it; a ChatGPT app needs it for tool discovery, typed tool calls, UI-resource delivery, and model/UI synchronization.

The current server creates a fresh MCP server and transport for every HTTP POST. It stores no design state, runs no OpenSCAD process, and creates no mesh. Every relevant call carries a complete snapshot.

| Tool | Purpose | What the server actually does |
| --- | --- | --- |
| `open_design` | Open arbitrary `.scad` source in the designer | Validates and returns the initial snapshot; tool metadata attaches the shared UI resource |
| `update_design` | Replace the current source | Validates and returns the complete replacement snapshot |
| `configure_design` | Apply Customizer values | Round-trips source, schema, and all current values |
| `export_design` | Request SCAD, STL, or 3MF export | Returns an export instruction; the iframe creates the file |

These tools are intentionally coarse. They give the model semantic actions while keeping browser state visible to the next model turn. They are not remote OpenSCAD commands.

The current iframe calls `configure_design` after debounced edits and then updates model context. Because `configure_design` only echoes the snapshot, this is a deliberate contract prototype rather than an efficient final sync path. Before public deployment we should test direct debounced `ui/update-model-context` from the iframe and retain `configure_design` only for model-driven parameter changes. That avoids repeatedly sending the complete source through a redundant tool round trip.

### Designer iframe

- Parses OpenSCAD Customizer annotations and generates grouped form controls.
- Owns the active source and values while mounted.
- Debounces local rendering and snapshot synchronization.
- Displays the actual STL through Three.js orbit controls.
- Packages rendered STL geometry into a basic millimeter-scale 3MF.
- Downloads `.scad`, `.stl`, and `.3mf` artifacts without first uploading them to our infrastructure.

### OpenSCAD browser worker

The iframe starts an isolated Web Worker containing `openscad-wasm-prebuilt`. The worker appends validated parameter assignments to the source, invokes the real OpenSCAD evaluator, and transfers the resulting STL buffer back to the iframe. A new worker is used for each render so a cancelled or failed Emscripten runtime cannot poison later renders.

“Arbitrary SCAD source” currently means self-contained source supported by this WASM build. There is no project-bundle or virtual-filesystem contract for `include`, `use`, imported STL/SVG/DXF files, textures, or user-provided fonts. Those dependencies require an explicit file workflow before we can claim support.

### Cloudflare deployment target

The planned hosted shape is:

- A small Cloudflare Worker exposing `/mcp` with a Web-standard, stateless Streamable HTTP transport.
- Workers Static Assets holding the built app resource and large OpenSCAD runtime.
- A `workers.dev` preview URL first, followed by a stable custom domain for publication.
- GitHub-triggered preview and production deployments.

The current Node `IncomingMessage` adapter is not the Cloudflare adapter. Porting it is a contained deployment task; the MCP server factory and tool contracts remain reusable.

## State and data lifecycle

| Data | Current owner | Persistence |
| --- | --- | --- |
| OpenSCAD source | Tool snapshot, iframe, then model context | Conversation context only; user can download `.scad` |
| Customizer values | Tool snapshot and iframe | Conversation context only |
| STL mesh | Iframe memory | Until iframe teardown; user can download STL |
| 3MF package | Created in iframe on demand | Download only |
| User identity | ChatGPT host | Not consumed by this app |
| Project history | None | Not implemented |

The MCP server can therefore scale horizontally without sticky sessions. There is no cross-user cache or singleton containing user data. The built HTML/WASM assets are shared and immutable; design data is not.

## Why not render on the backend now?

Browser rendering has useful product and privacy properties:

- Rendered meshes do not need to be uploaded to our infrastructure; source only transits through the stateless tool snapshots needed for model/UI synchronization.
- Rendering capacity scales with users instead of consuming centralized compute.
- There are no queues, render workers, file stores, cleanup jobs, or per-render infrastructure costs.
- The same code can also run as a standalone local web app.

A backend renderer becomes justified if the developer-mode spike establishes one or more of these conditions:

1. ChatGPT’s iframe policy blocks the WASM module or module worker.
2. The runtime cannot be packaged within acceptable resource and startup limits.
3. Representative models exceed browser memory or latency budgets.
4. Required fonts, imports, libraries, or filesystem features cannot be supplied safely in-browser.
5. We require authoritative server-side validation, thumbnail generation, batch jobs, or persistent artifact URLs.

If that gate is crossed, OpenSCAD should run in an isolated, resource-limited container service rather than inside the lightweight MCP Worker. The MCP layer would enqueue or proxy render jobs and return artifact references. That is a fallback architecture, not an MVP prerequisite.

## Independent-user isolation

Independent use requires no shared application state. Each invocation is naturally isolated by the ChatGPT iframe and the request-scoped MCP server. Production hardening still needs request limits, rate limiting, telemetry, and concurrency testing.

Shared collaboration is not a future product track. The architecture must not add shared project membership, collaborative permissions, presence, live synchronization, CRDTs, or shared-session infrastructure. A future personal persistence feature, if requested, should retain single-user ownership and the same cross-user isolation boundary.

## Security and reliability boundaries

- Treat all tool input and OpenSCAD source as untrusted.
- Keep evaluation off the MCP control-plane isolate.
- Add source-size, render-time, memory, triangle-count, and diagnostic-output limits before broad distribution.
- Preserve cancellation so rapid parameter changes terminate superseded workers.
- Declare exact CSP resource origins and a unique widget domain before publication.
- Do not claim a model is printable merely because OpenSCAD produced a mesh; dimensional and mechanical validation remain the user’s responsibility.
- Do not generate G-code. Slicer profiles, orientation, supports, and printer control remain downstream.

## Architecture decisions

1. **Browser-first rendering:** keep the real OpenSCAD evaluator in an iframe Web Worker for the first hosted spike.
2. **Stateless MCP snapshots:** every tool call carries the complete current design state.
3. **No persistence in v1:** source and meshes stay client-side unless the user downloads them.
4. **No shared editing:** collaboration is an explicit product non-goal; concurrency means isolated independent users.
5. **Cloudflare as the first deployment target:** use a Worker for MCP and static assets for the large runtime.
6. **Backend rendering is gated by evidence:** introduce it only after a sandbox, feature, or performance failure demonstrates the need.

## References

- [OpenAI: deploy an Apps SDK app](https://developers.openai.com/apps-sdk/deploy)
- [OpenAI: build the ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [Cloudflare: build an interactive ChatGPT app](https://developers.cloudflare.com/workers/demos/chatgpt-app/)
- [Cloudflare: build a remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
