const PROXY_PATHS = ["/api/", "/ws/"];

function shouldProxy(pathname) {
  return pathname === "/health" || PROXY_PATHS.some((prefix) => pathname.startsWith(prefix));
}

function unavailable(message, status) {
  return Response.json({ detail: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (!shouldProxy(incoming.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const configuredOrigin = env.BACKEND_ORIGIN;
    if (!configuredOrigin) {
      return unavailable("The research API has not been connected yet.", 503);
    }

    let target;
    try {
      const backend = new URL(configuredOrigin);
      if (backend.protocol !== "https:") {
        return unavailable("The research API must use HTTPS.", 500);
      }
      target = new URL(`${incoming.pathname}${incoming.search}`, backend.origin);
    } catch {
      return unavailable("The research API origin is invalid.", 500);
    }

    try {
      // Forward cookies and Origin unchanged so API, OAuth callbacks, and
      // authenticated WebSockets all remain on the public app's same origin.
      return await fetch(new Request(target, request));
    } catch {
      return unavailable("The research API is temporarily unreachable.", 502);
    }
  },
};
