# Cloudflare deployment

OpenSCAD Designer is published only by GitHub Actions. Local commands may run the Worker or produce a dry build, but they must not deploy it.

## GitHub Environments

Create two repository environments named `preview` and `production`. Configure the credential and account separately in each environment, and configure the production Worker name once as a repository variable:

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler without exposing the token to logs or pull requests |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account |
| Repository variable | `CLOUDFLARE_PRODUCTION_WORKER_NAME` | Names the single Worker that owns production traffic and PR preview versions |

Preview and production use the same Worker name but separate environment-scoped tokens. Give the preview token only the permissions needed to upload a version, and give the production token the permissions needed to deploy that Worker. Do not commit tokens, account IDs, `.env` files, `.dev.vars`, or generated credential files.

Require a reviewer for `production`, prevent self-review and admin bypass, and restrict it to deployments from `main`. A reviewer is also recommended for `preview`: same-repository pull-request code and its deployment artifact are untrusted until reviewed. The credential-bearing jobs do not check out repository code, run package lifecycle scripts, or bundle source.

## Preview pipeline

The preview workflow runs only for non-draft pull requests whose head repository is this repository. Pull requests from forks must never enter a credential-bearing job and must never receive environment secrets.

An unprivileged build job checks out the pull request, installs dependencies, runs the full check suite, and uploads only the prebuilt Worker script and static app asset. A separate job then enters the `preview` environment, downloads that same-run artifact, and uses a fixed deployment configuration with bundling disabled. It never checks out the pull request or executes its package scripts. The pinned Wrangler CLI is installed with lifecycle scripts disabled before the Cloudflare secret is passed to the pinned deployment action.

The credentialed job uploads the revision to the production Worker's version history with a pull-request alias, but does not deploy that version to production traffic:

```sh
wrangler versions upload --config wrangler.deploy.jsonc --name "$CLOUDFLARE_PRODUCTION_WORKER_NAME" --preview-alias "pr-${PR_NUMBER}"
```

The `pr-N` alias gives each pull request a stable URL while new commits create new underlying versions. Keep the Worker name short enough that `pr-N-<worker-name>` stays within Cloudflare's 63-character DNS label limit. GitHub records the unique URL for the exact uploaded version on its environment deployment. Version uploads do not change the deployment that serves production traffic, and preview URLs are public.

## Production pipeline

The production workflow runs for pushes to `main` and may also be started with `workflow_dispatch`. A manual run must still publish from `refs/heads/main`. It uses the same unprivileged-build and artifact-only-deploy boundary, then enters the `production` environment and runs:

```sh
wrangler deploy --config wrangler.deploy.jsonc --name "$CLOUDFLARE_PRODUCTION_WORKER_NAME"
```

Only this workflow promotes a Worker to production.

## Runtime endpoints

Every deployed Worker exposes:

- `/mcp` — the stateless Streamable HTTP endpoint configured in ChatGPT developer mode.
- `/health` — a lightweight readiness response for deployment checks and monitoring.

The MCP endpoint is intentionally anonymous. Every entry returned by `tools/list` must contain `securitySchemes: [{ "type": "noauth" }]` and the same array at `_meta.securitySchemes`. ChatGPT uses those explicit declarations instead of attempting OAuth discovery. This is a release contract and is covered by both server and raw Worker transport tests.

## Local verification

```sh
npm run dev:cloudflare
npm run build:cloudflare
```

`dev:cloudflare` starts the local Worker. `build:cloudflare` builds the UI and performs a dry Worker bundle build; it does not publish. All preview and production publishing remains owned by GitHub Actions.
