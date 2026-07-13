# Cloudflare deployment

OpenSCAD Designer is published only by GitHub Actions. Local commands may run the Worker or produce a dry build, but they must not deploy it.

## GitHub Environments

Create two repository environments named `preview` and `production`. Configure these values separately in each environment:

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler without exposing the token to logs or pull requests |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account |
| Variable | `CLOUDFLARE_WORKER_NAME` | Names the Worker deployed by that environment |

The variables are environment-scoped, so preview and production use distinct Worker names and namespaces without changing the workflow. **The two `CLOUDFLARE_WORKER_NAME` values must be different:** the preview pipeline deploys to its own rolling Worker before creating a per-PR alias. Prefer separate preview and production tokens. Give each token access only to the intended account and the minimum Worker Scripts permissions needed to upload or deploy. Do not commit tokens, account IDs, `.env` files, `.dev.vars`, or generated credential files.

Require a reviewer for `production`, prevent self-review and admin bypass, and restrict it to deployments from `main`. A reviewer is also recommended for `preview`: same-repository pull-request code is untrusted until reviewed, and Wrangler must build that code during the credential-bearing upload step.

## Preview pipeline

The preview workflow runs only for non-draft pull requests whose head repository is this repository. Pull requests from forks must never enter a credential-bearing job and must never receive environment secrets.

After validation and a dry build, the workflow uses the `preview` environment. It first deploys the revision to the dedicated preview Worker so a fresh namespace is bootstrapped entirely through GitHub Actions:

```sh
wrangler deploy --name "$CLOUDFLARE_WORKER_NAME"
```

It then uploads the same revision with a pull-request alias:

```sh
wrangler versions upload --name "$CLOUDFLARE_WORKER_NAME" --preview-alias "pr-${PR_NUMBER}"
```

The preview Worker's main URL therefore tracks the most recently completed preview job. The `pr-N` alias gives each pull request a stable URL while new commits create new underlying versions. Keep the preview Worker name short enough that `pr-N-<worker-name>` stays within Cloudflare's 63-character DNS label limit. GitHub records the unique URL for the exact uploaded version on its environment deployment. Neither preview step touches the separately named production Worker, and preview URLs are public.

## Production pipeline

The production workflow runs for pushes to `main` and may also be started with `workflow_dispatch`. A manual run must still publish from `refs/heads/main`. After the same validation and dry build, it uses the `production` environment and runs:

```sh
wrangler deploy --name "$CLOUDFLARE_WORKER_NAME"
```

Only this workflow promotes a Worker to production.

## Runtime endpoints

Every deployed Worker exposes:

- `/mcp` — the stateless Streamable HTTP endpoint configured in ChatGPT developer mode.
- `/health` — a lightweight readiness response for deployment checks and monitoring.

## Local verification

```sh
npm run dev:cloudflare
npm run build:cloudflare
```

`dev:cloudflare` starts the local Worker. `build:cloudflare` builds the UI and performs a dry Worker bundle build; it does not publish. All preview and production publishing remains owned by GitHub Actions.
