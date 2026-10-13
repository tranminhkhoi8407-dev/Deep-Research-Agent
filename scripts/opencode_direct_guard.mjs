/* Reviewed in-process guard for the opt-in, genuine OpenCode provider.
 * No proxy, fabricated client metadata, replacement tools or paid fallback.
 * The normal OpenCode SDK still creates and sends its own provider request.
 */
const PROVIDER_URL = 'https://opencode.ai/inference/openai/v1/chat/completions';
const MUSE = 'muse-spark-1.3-contributor-free';
const ALLOWED_MODELS = new Set(['mimo-v2.6-flash-free', 'longcat-2.5-preview-free', MUSE]);
const ALLOWED_TOOLS = new Set(['nexora_evidence_search', 'nexora_evidence_read', 'StructuredOutput']);
const safeError = code => Object.assign(new Error(code), { code });

export function createGuard({ controlURL, token, key, model, interactive = false, fetchImpl = globalThis.fetch, providerURL = model === MUSE ? 'https://opencode.ai/inference/openai/v1/responses' : PROVIDER_URL }) {
  const control = new URL(controlURL);
  if (control.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(control.hostname) || control.username || control.password || control.search || control.hash || !control.pathname.endsWith('/internal/opencode/direct')) throw safeError('opencode_direct_configuration');
  if (!ALLOWED_MODELS.has(model) || !key || !token || token.length < 32) throw safeError('opencode_direct_configuration');
  let current;
  const call = async (action, data) => {
    const response = await fetchImpl(control.href.replace(/\/$/, '') + '/' + action, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(data),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw safeError(typeof value.detail === 'string' && /^opencode_[a-z_]+$|^cancelled$/.test(value.detail) ? value.detail : 'opencode_direct_control_unavailable');
    return value;
  };
  const checked = input => {
    if (input.model?.providerID !== 'opencode' || input.model?.id !== model || input.agent !== 'build' || !/^ses_[A-Za-z0-9]+$/.test(input.sessionID)) throw safeError('opencode_direct_model_changed');
    return input.sessionID;
  };
  const beforeFetch = async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url !== providerURL || init.method !== 'POST' || typeof init.body !== 'string' || init.body.length > 400000 || !current) throw safeError('opencode_direct_request_rejected');
    const body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    const responses = model === MUSE;
    if (body.model !== model || !(responses ? Array.isArray(body.input) : Array.isArray(body.messages)) || headers.get('x-opencode-session') !== current.session) throw safeError('opencode_direct_model_changed');
    // The server owns all context. Never permit retrieval of another provider
    // response or server-side continuation outside the metered local session.
    if (responses && (body.previous_response_id || body.conversation || body.background)) throw safeError('opencode_direct_request_rejected');
    // Count the REAL serialized request, including OpenCode's genuine tool
    // definitions and accumulated session history, before any upstream fetch.
    let reserved;
    try {
      reserved = await call('reserve', { session: current.session, model, provider: 'opencode', input_estimate: new TextEncoder().encode(init.body).length + 4096, request_id: crypto.randomUUID() });
    } catch (error) {
      await call('error', { code: error.code === 'opencode_direct_budget' ? error.code : 'opencode_direct_control_unavailable' }).catch(() => {});
      throw error;
    }
    const cap = reserved.output_cap;
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1800 || reserved.deadline * 1000 <= Date.now()) throw safeError('opencode_direct_budget');
    const limitField = responses ? 'max_output_tokens' : 'max_tokens';
    body[limitField] = Math.min(cap, Number.isSafeInteger(body[limitField]) && body[limitField] > 0 ? body[limitField] : cap);
    delete body.max_completion_tokens;
    if (responses) { delete body.max_tokens; delete body.stream_options; body.store = false; }
    else body.stream_options = body.stream ? { include_usage: true } : undefined;
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, Math.min(60000, reserved.deadline * 1000 - Date.now()))) ]);
    let response;
    try {
      response = await fetchImpl(input, { ...init, body: JSON.stringify(body), signal, redirect: 'error' });
    } catch {
      await call('error', { code: 'opencode_direct_provider_unavailable' }).catch(() => {});
      throw safeError('opencode_direct_provider_unavailable');
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const code = failure.error?.type === 'FreeTierError' ? 'opencode_free_tier_restricted' : response.status === 429 ? 'opencode_capacity' : response.status === 401 ? 'opencode_provider_authentication' : 'opencode_provider_rejected';
      await call('error', { code, status: response.status });
      // Never expose upstream headers/body or let SDK retry an access denial.
      return new Response(JSON.stringify({ error: { message: code, code } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!body.stream) {
      const value = await response.json();
      await call('settle', { request_id: reserved.request_id, usage: value.usage || {} });
      return Response.json(value);
    }
    const decoder = new TextDecoder(); let tail = '', usage = {};
    const collect = line => {
      if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') return;
      try { const value = JSON.parse(line.slice(5)); if (value.usage || value.response?.usage) usage = value.usage || value.response.usage; } catch { /* partial SSE lines are buffered */ }
    };
    const stream = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk); tail += decoder.decode(chunk, { stream: true });
        if (tail.length > 500000) throw safeError('opencode_direct_response_limit');
        const lines = tail.split('\n'); tail = lines.pop() || ''; lines.forEach(collect);
      },
      async flush() { collect(tail + decoder.decode()); await call('settle', { request_id: reserved.request_id, usage }); },
    }));
    return new Response(stream, { status: response.status, headers: response.headers });
  };
  return {
    configure(config) {
      if (config.enabled_providers?.length !== 1 || config.enabled_providers[0] !== 'opencode' || Object.keys(config.provider || {}).some(id => id !== 'opencode') || config.permission?.['*'] !== 'ask' || config.agent?.build?.permission?.['*'] !== 'ask') throw safeError('opencode_direct_configuration');
      // The saved profile's endpoint is a closed loopback port. Without this
      // plugin, or if plugin loading fails, it cannot contact any provider.
      const options = config.provider.opencode.options;
      options.fetch = beforeFetch;
      options.baseURL = providerURL.replace(/\/(chat\/completions|responses)$/, '');
      options.apiKey = key;
    },
    async params(input, output) {
      const session = checked(input);
      await call('check', { session, model, provider: 'opencode' });
      current = { session };
      output.maxOutputTokens = Math.min(output.maxOutputTokens || 1800, 1800);
    },
    async tool(input) {
      if (!ALLOWED_TOOLS.has(input.tool) && !(interactive && model === MUSE && input.tool === 'question')) {
        await call('blocked-tool', { tool: String(input.tool).slice(0, 100) }).catch(() => {});
        throw safeError('opencode_direct_tool_denied');
      }
      await call('tool', { session: input.sessionID, tool: input.tool, model });
    },
    fetch: beforeFetch,
  };
}

export const NexoraDirectGuard = async () => {
  const guard = createGuard({ controlURL: process.env.NEXORA_DIRECT_CONTROL_URL, token: process.env.NEXORA_DIRECT_LEASE_TOKEN, key: process.env.NEXORA_DIRECT_PROVIDER_KEY, model: process.env.NEXORA_DIRECT_MODEL, interactive: process.env.NEXORA_DIRECT_HIL === 'true' });
  return {
    config: config => guard.configure(config),
    'chat.params': (input, output) => guard.params(input, output),
    'tool.execute.before': input => guard.tool(input),
    'permission.ask': (_input, output) => { output.status = 'deny'; },
    'shell.env': () => { throw safeError('opencode_direct_tool_denied'); },
    'command.execute.before': () => { throw safeError('opencode_direct_tool_denied'); },
  };
};
export default { id: 'nexora-direct-guard', server: NexoraDirectGuard };
