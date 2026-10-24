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

1. Deploy the frontend with `npm run deploy` after Wrangler is authenticated.
   Until `BACKEND_ORIGIN` is configured, API calls safely return `503`.
2. In Cloudflare Worker settings, add the non-secret variable
   `BACKEND_ORIGIN=https://<your-render-service-domain>`. Alternatively run
   `npx wrangler secret put BACKEND_ORIGIN` and enter your own HTTPS backend
   origin. A Worker secret is also fine for this URL, although it is not an API
   credential.
3. Set the backend's `FRONTEND_URL`, `BACKEND_URL` and `CORS_ORIGINS` to the
   Worker origin, then verify `https://<your-worker-domain>/health`.
4. Register Google/GitHub OAuth callbacks on that Worker origin:
   `/api/auth/callback/google` and `/api/auth/callback/github`.

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
