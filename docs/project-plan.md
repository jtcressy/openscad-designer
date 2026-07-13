# OpenSCAD Designer project plan

Status: active delivery plan; PR 1 is complete and the PR 2 adapter is implemented pending hosted preview credentials.

## Product goal

Ship a trustworthy ChatGPT plugin for independently creating and refining parametric OpenSCAD designs, previewing the actual evaluated mesh, and downloading SCAD, STL, or 3MF files for a slicer.

This project is not a shared CAD workspace. Shared documents, membership, permissions, presence, and real-time collaboration are explicit non-goals. Supporting many independent users must not introduce collaboration infrastructure.

## Current baseline

The standalone repository baseline contains:

- four stateless MCP snapshot tools and one shared MCP App resource;
- a Customizer annotation parser and generated parameter forms;
- real OpenSCAD-WASM evaluation in a browser Web Worker;
- a Three.js orbit preview;
- STL and basic 3MF download paths;
- source/value synchronization into model-visible context;
- twenty-four passing unit and integration tests, including dimensional verification of a rendered STL, Cloudflare route contracts, and export-name normalization;
- a Node Streamable HTTP development server and validated plugin scaffold;
- a Cloudflare Worker adapter, Static Assets packaging, and GitHub Actions definitions for preview and production deployment.

ChatGPT supplies the model runtime. The deployed app does not require a separate OpenAI backend process or OpenAI API key.

The current build has not run inside the real ChatGPT iframe. Cloudflare compatibility is covered by the adapter and dry build, but the first hosted preview still requires environment credentials.

## Delivery principles

- Test the riskiest assumption first: can the real ChatGPT sandbox execute this OpenSCAD WASM worker?
- Keep the MCP endpoint stateless until persistence is an explicit user requirement.
- Keep any future personal persistence single-user; do not add shared-project or real-time collaboration semantics.
- Keep server and UI contracts transport-neutral so deployment work does not rewrite product logic.
- Use one reviewable pull request per milestone.
- Do not add a backend renderer merely to make the architecture look conventional.

## Milestones

### PR 1 — Standalone MVP and architecture baseline

Scope:

- establish the dedicated repository and land the browser-rendered prototype;
- document the MCP tool contract and runtime boundaries;
- document independent-user isolation and the explicit collaboration non-goal;
- record the phased plan and backend-rendering decision gate.

Acceptance criteria:

- `npm run check` passes;
- plugin validation passes;
- the diagram agrees with the implementation;
- reviewers can identify exactly where source, values, and meshes live;
- documentation states that shared editing is outside the product scope;
- repository metadata, licensing, and CI are present at the project root.

### PR 2 — Cloudflare deployment adapter

Scope:

- add `wrangler.jsonc` with a current compatibility date;
- add a Web-standard Cloudflare Worker entry point at `/mcp`;
- reuse the existing MCP server factory and request-scoped stateless behavior;
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
- verify model/UI round trips after source and parameter changes;
- remove the redundant iframe-to-`configure_design` echo path only if direct model-context synchronization passes this compatibility test.

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
| “Collaborative” wording overpromises | Product/content review | Say “interactive with ChatGPT” and state that shared editing is out of scope |

## Immediate next actions

1. Review the Cloudflare adapter PR and configure the `preview` and `production` GitHub Environments.
2. Let the preview workflow publish the first credentialed Worker version.
3. Connect the preview endpoint in ChatGPT developer mode.
4. Make the browser-versus-backend rendering decision from that test.
5. Continue through hardening and publication as separate, reviewable PRs.
