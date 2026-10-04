# Render backend preview (free)

This is a **temporary test deployment**, not a durable home for user data.
Render Free can sleep and restart; its local filesystem is ephemeral. This app
currently stores accounts, notebooks, paper collections, and collaboration
state in SQLite, and reports in local files. Those records can disappear after
a restart or redeploy. The public frontend is connected only to verify API
reachability; do not invite real users or store real data until durable storage
and backups are in place.

## Create the backend

1. Push a branch containing `Dockerfile` and `render.yaml` to the private GitHub
   repository. In Render, connect GitHub and grant access to that repository.
2. In the existing **Deep Research Agent** project, choose **Create new
   service → Web Service**, select the repository and the pushed branch.
3. Select **Docker** runtime, **Free** instance, repository root as root
   directory, `./Dockerfile` as Dockerfile path, and `/health` as health path.
   The Dockerfile starts Uvicorn on Render's `$PORT` automatically. Do not set
   a build command or start command in the dashboard.
4. Add the non-secret variables from `render.yaml`. Generate a new long random
   value for `AUTH_SESSION_SECRET` in the Render dashboard. Never commit it.
   If creating from the Blueprint instead, Render generates it automatically.
5. Deploy and wait for **Live**. Open `https://nexora-api-preview.onrender.com/health`;
   it should return `{"status":"ok","service":"deep-research-agent"}`.

The Blueprint file is provided for repeatable configuration. Manual Web
Service creation in the existing Render project does **not** import its
variables automatically; enter them in the service's Environment page.

## Connect sign-in and research later

- Add either `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` or the GitHub
  equivalents in Render Environment. Register the matching callback at
  `https://deep-research-agent.tranminhkhoi8407.workers.dev/api/auth/callback/google`
  or `/github` **only after** the Cloudflare Worker proxy is deployed.
- Add `GEMINI_API_KEY` (or another supported model provider) and
  `TAVILY_API_KEY` for research. Never put secret values in `VITE_*` variables,
  Git, or the frontend.
- The Cloudflare Worker is configured with
  `BACKEND_ORIGIN=https://nexora-api-preview.onrender.com`. It forwards
  same-origin `/api`, `/ws`, and `/health` to Render. Verify
  `https://deep-research-agent.tranminhkhoi8407.workers.dev/health` returns OK.
- Before production use, migrate SQLite and report storage to a persistent
  service or a Render paid persistent disk, add backups, and test OAuth and
  WebSocket through the Worker domain. Do not rely on Render Free's filesystem.

Render Free can also take time to wake on the first request after inactivity.
