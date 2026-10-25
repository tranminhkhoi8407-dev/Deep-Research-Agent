# Render preview deployment

`render.yaml` is a **preview template**, not a production-ready hosting plan.
The application stores accounts, notebooks, paper collections, collaboration
state and reports on disk. Before inviting real users, configure durable
storage, tested backups, email delivery and monitoring. Confirm the current
limits of your Render plan before relying on it for persistent user data.

This guide intentionally contains no maintainer-owned API or Worker URL. A
fork must use a backend and frontend domain controlled by its operator.

## Create your own backend

1. Fork or clone this repository into your own GitHub account.
2. In Render, create a new Blueprint from your repository and select
   `render.yaml`, or create a Docker Web Service using the repository root,
   `Dockerfile` and `/health` health path. The Docker image listens on Render's
   `$PORT`; do not add a separate start command.
3. Set `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGINS` in the service settings.
   For a Cloudflare Worker proxy, use the Worker origin for all three values.
   For a separate frontend and API, set the frontend origin in
   `FRONTEND_URL`/`CORS_ORIGINS` and the public API origin in `BACKEND_URL`.
4. Confirm `APP_ENV=production`, `AUTH_DEV_LOGIN=false`,
   `AUTH_COOKIE_SECURE=true`, and a unique generated `AUTH_SESSION_SECRET`.
   Never reuse the sample local secret or commit credentials.
5. Add one supported LLM provider key, `TAVILY_API_KEY`, and the SMTP variables
   from `.env.example` if password reset by email is enabled.
6. Deploy and check `https://<your-render-service-domain>/health` for a JSON
   response with status `ok`.

`render.yaml` marks user-specific origins and snapshot credentials as
`sync: false`; enter values in your own service's Environment settings. The
generated `deep-research-agent-api` service name is only a starting point. Use
the actual public URL Render assigns to your service; do not copy an origin
from this repository's previous preview deployment.

## Connect a Cloudflare Worker

The Worker serves the compiled frontend and proxies `/api/*`, `/ws/*` and
`/health` to the URL in `BACKEND_ORIGIN`. `wrangler.jsonc` intentionally omits
that value so a fork cannot silently send its users' requests to the
maintainer's preview backend.

1. From the repository root run `npm ci`, then deploy the frontend with
   `npm run deploy` after Wrangler is authenticated. Wrangler is pinned in the
   root lockfile, and `--keep-vars` preserves variables already configured on
   the Worker. Until `BACKEND_ORIGIN` is configured, API calls safely return
   `503`.
2. In Cloudflare Worker settings, add the non-secret variable
   `BACKEND_ORIGIN=https://<your-render-service-domain>`. Alternatively run
   `npx wrangler secret put BACKEND_ORIGIN` and enter your own HTTPS backend
   origin. A Worker secret is also fine for this URL, although it is not an API
   credential.
3. Set the backend's `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGINS` to the
   Worker origin, then verify `https://<your-worker-domain>/health`.
4. Register Google/GitHub OAuth callbacks on that Worker origin:
   `/api/auth/callback/google` and `/api/auth/callback/github`.

### Optional Cloudflare pull-request previews

If you enable Cloudflare Workers Builds for pull-request previews, set its
**Build command** to `npm run build` and **Preview command** to
`npx wrangler preview`. The Wrangler config contains an empty `previews` block
because the preview command requires one. It is intentionally empty so forks do
not contact the maintainer's backend. Preview settings do not inherit production
variables; add a preview-only `BACKEND_ORIGIN` if the preview should reach an API.
Keep the production deployment on GitHub Actions (`npx wrangler deploy`), which
receives `BACKEND_ORIGIN` from the repository's Actions variable. Make sure
Workers Builds is not also deploying the production Worker from `main`; only one
pipeline should own production deployments.

## Optional GitHub Actions CD

`.github/workflows/ci.yml` can deploy the Render API and Cloudflare Worker after
all CI jobs pass on `main`. Deployments are disabled unless the repository
Actions variable `CD_ENABLED` is set to the exact value `true`; fork owners can
run CI without providing any deployment credentials.

1. Create the Render service from this repository, configure its production
   environment, and confirm `/health` works. In the Render service settings,
   turn **Auto-Deploy off** so an unverified push cannot deploy before GitHub
   Actions finishes. Create a deploy hook for the service.
2. Create a Cloudflare API token with the **Edit Cloudflare Workers** permission
   scoped to only the account that owns this Worker. The workflow uses Wrangler
   to deploy the worker and static assets.
3. In GitHub repository **Settings → Secrets and variables → Actions**, add
   these repository variables:

   - `CD_ENABLED`: `true`
   - `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID
   - `BACKEND_ORIGIN`: the Render API origin, such as
     `https://your-api.onrender.com` (no `/health` suffix)
   - `PUBLIC_APP_URL`: the public Worker or custom-domain origin, such as
     `https://your-app.example.com` (no path)

   Add these Actions secrets:

   - `RENDER_DEPLOY_HOOK_URL`: the secret hook URL from Render
   - `CLOUDFLARE_API_TOKEN`: the scoped Cloudflare API token

4. Ensure the backend's `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGINS` point
   to `PUBLIC_APP_URL`. Push to `main`, or manually run the workflow on `main`.
   GitHub first waits for tests, requests a Render deploy of that exact commit,
   waits up to 20 minutes for API health, deploys the Worker with
   `BACKEND_ORIGIN`, then checks the public Worker health endpoint.

Do not put `.env`, provider API keys, OAuth secrets or SMTP passwords in GitHub
variables. Provider credentials stay in the Render service's secret environment.
If any variable or secret is missing, the enabled deployment job fails before
it requests deployment; leave `CD_ENABLED` unset to keep CD off.

For `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` and set
`BACKEND_ORIGIN` to an HTTPS API you control. `.dev.vars` is ignored by Git.
Never put OAuth/API credentials in `VITE_*` variables; those are compiled into
public JavaScript.

## Data durability and restore

The preview template uses local SQLite and local report files. Durable snapshot
support in `.env.example` is optional and requires credentials to a private
backup repository or object store. Set the provider credentials as secrets in
your hosting dashboard, verify that snapshots complete, and test restoring to
a clean service before storing real user data. A backup that has not been
restored in a test is not verified. Keep the code repository separate from
the private snapshot repository.

For production with multiple users or replicas, use supported shared storage
and a database/concurrency design intended for that topology; do not attach
multiple API replicas to one arbitrary SQLite filesystem. Review README's
operational limits, password reset, rate limiting and backup notes before
opening registration.
