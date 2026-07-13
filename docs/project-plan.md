# OpenSCAD Designer project plan

Status: proposed delivery plan following the standalone MVP.

## Product goal

Ship a trustworthy ChatGPT plugin for independently creating and refining parametric OpenSCAD designs, previewing the actual evaluated mesh, and downloading SCAD, STL, or 3MF files for a slicer.

The first release is not a shared CAD workspace. Real-time collaboration is an optional later product track and must not force accounts, databases, or centralized rendering into the initial architecture.

## Current baseline

The standalone repository baseline contains:

- four stateless MCP snapshot tools and one shared MCP App resource;
- a Customizer annotation parser and generated parameter forms;
- real OpenSCAD-WASM evaluation in a browser Web Worker;
- a Three.js orbit preview;
- STL and basic 3MF download paths;
- source/value synchronization into model-visible context;
- sixteen passing unit and integration tests, including dimensional verification of a rendered STL and export-name normalization;
- a Node Streamable HTTP development server and validated plugin scaffold.

ChatGPT supplies the model runtime. The deployed app does not require a separate OpenAI backend process or OpenAI API key.

The current build has not run inside the real ChatGPT iframe and is not Cloudflare-compatible yet.

## Delivery principles

- Test the riskiest assumption first: can the real ChatGPT sandbox execute this OpenSCAD WASM worker?
- Keep the MCP endpoint stateless until persistence is an explicit user requirement.
- Keep server and UI contracts transport-neutral so deployment work does not rewrite product logic.
- Use one reviewable pull request per milestone.
- Do not add a backend renderer merely to make the architecture look conventional.

## Milestones

### PR 1 — Standalone MVP and architecture baseline

Scope:

- establish the dedicated repository and land the browser-rendered prototype;
- document the MCP tool contract and runtime boundaries;
- document independent-user versus shared-collaboration semantics;
- record the phased plan and backend-rendering decision gate.

Acceptance criteria:

- `npm run check` passes;
- plugin validation passes;
- the diagram agrees with the implementation;
- reviewers can identify exactly where source, values, and meshes live;
- no claim implies that real-time shared editing already exists.
- repository metadata, licensing, and CI are present at the project root.

### PR 2 — Cloudflare deployment adapter

Scope:

- add `wrangler.jsonc` with a current compatibility date;
- add a Web-standard Cloudflare Worker entry point at `/mcp`;
- reuse the existing MCP server factory and request-scoped stateless behavior;
- remove the redundant iframe-to-`configure_design` echo path if direct model-context synchronization passes compatibility testing;
- package the app as Workers Static Assets instead of embedding it in the Worker script;
- add local Worker tests and deployment documentation;
- configure preview deployments from GitHub.

Acceptance criteria:

- `wrangler dev` serves a working MCP endpoint;
- MCP Inspector can initialize, list all four tools, read the UI resource, and call each tool;
- the compressed Worker script remains below the selected Cloudflare-plan limit;
- the OpenSCAD payload is served as an asset rather than Worker code;
- the development command serves the real built app resource rather than the checked-in placeholder;
- no design snapshot is retained between independent requests;
- a Cloudflare preview URL is available.

### PR 3 — ChatGPT developer-mode spike

Scope:

- connect the preview `/mcp` endpoint in ChatGPT developer mode;
- test the actual iframe rather than a standalone browser page;
- capture console, network, CSP, WASM, and worker failures;
- measure first render, rerender, memory behavior, and bundle transfer;
- verify model/UI round trips after source and parameter changes.

Acceptance criteria:

- open a parametric cube from a prompt;
- change at least two parameters without stale or reverted state;
- edit source, rerender, and confirm the next model turn sees the new source;
- orbit and reset the mesh while preserving the model origin/build plane;
- download SCAD, STL, and 3MF;
- import STL and 3MF into a representative slicer;
- teardown during a render does not leak or hang a worker.

Decision gate:

| Result | Next action |
| --- | --- |
| Inline app resource and WASM worker work acceptably | Keep the browser-first architecture |
| Resource is too large but external assets are permitted | Split JS/WASM into versioned Cloudflare assets and declare exact CSP origins |
| WASM/worker policy is blocked | Prototype a server-side render service |
| Browser performance fails only for complex models | Add limits and an opt-in remote render fallback |

No backend renderer should be scheduled before this result is known.

### PR 4 — Reliability, privacy, and abuse controls

Scope:

- impose source-size, value-count, render-time, diagnostic, and mesh-complexity limits;
- add structured client and Worker telemetry without logging design source by default;
- add Cloudflare rate limiting and production CORS policy;
- define failure messages and recovery behavior;
- pin the widget domain and CSP;
- add a privacy/data-flow document and threat model;
- complete license and third-party notices.

Acceptance criteria:

- malformed or intentionally expensive source fails within documented bounds;
- superseded renders are cancelled cleanly;
- two simultaneous users cannot observe one another’s state;
- logs contain correlation and performance data without source or mesh contents;
- all external origins are explicit;
- dependency and license obligations are documented.

### PR 5 — File workflow and product UX

Scope:

- import and export `.scad` files through supported ChatGPT file APIs where available;
- preserve a browser fallback for file download;
- improve Customizer compatibility and diagnostics;
- add accessible keyboard, mobile, and fullscreen workflows;
- add sample models and guided empty states;
- validate generated 3MF packages against multiple slicers.

Acceptance criteria:

- a user can begin from a prompt or an existing SCAD file;
- all controls are keyboard accessible and labeled;
- errors identify useful source locations where possible;
- exported artifacts are deterministically named and open in target tools;
- no slicer or printer-control capability is implied.

### PR 6 — Publication candidate

Scope:

- choose the permanent product name, icon, domain, support contact, and developer identity;
- create privacy policy, terms, support, and deletion documentation;
- add model-tool evaluations and manual review scripts;
- complete plugin metadata and submission materials;
- run the OpenAI publication checklist.

Acceptance criteria:

- production runs at a stable HTTPS `/mcp` endpoint with monitoring;
- tool descriptions, annotations, schemas, and UI metadata pass review;
- required legal and support URLs are public;
- evaluation cases cover new design, revision, parameter change, invalid source, and export;
- a rollback procedure is tested;
- the plugin is ready to submit, not merely deployable.

## Optional shared-collaboration track

This track begins only if user research demonstrates that multiple people editing one design is a core use case.

Proposed increments:

1. Authenticated personal projects and revision history.
2. Share links with explicit read or edit permissions.
3. Optimistic concurrency and conflict detection.
4. Real-time presence and text synchronization.
5. Collaborative comments or review checkpoints.

Likely infrastructure includes Durable Objects for a live project session, D1 for metadata and permissions, and R2 for source or generated artifacts. A CRDT or other merge strategy is required before claiming simultaneous editing.

## Risk register

| Risk | Evidence needed | Mitigation |
| --- | --- | --- |
| ChatGPT blocks the blob/module worker or WASM | Developer-mode cube render | Split assets or gate a container renderer |
| App resource is too large or slow | Transfer and first-render measurements | Static assets, caching, code splitting, lazy runtime load |
| Complex SCAD exhausts the browser | Representative stress models | Time, memory, source, and triangle limits |
| Browser runtime lacks fonts/imports/features | Compatibility corpus | Bundle approved assets or remote-render only those models |
| Snapshot tools lose model-visible edits | Multi-turn UI/model tests | Complete snapshot contract plus teardown flush |
| Public endpoint is abused | Load and rate-limit tests | Stateless design, Cloudflare limits, explicit quotas |
| GPL obligations are incomplete | License review | Full license and third-party notices before distribution |
| “Collaborative” wording overpromises | Product/content review | Say “interactive with ChatGPT”; reserve “shared editing” for the optional track |

## Immediate next actions

1. Review and merge the standalone MVP/architecture PR.
2. Create the Cloudflare adapter PR without adding persistence or server-side CAD.
3. Connect the preview endpoint in ChatGPT developer mode.
4. Make the browser-versus-backend rendering decision from that test.
5. Continue through hardening and publication as separate, reviewable PRs.
