/* Synthetic transport for the genuine CLI harness. Never used by the app. */
import { createGuard } from '../../scripts/opencode_direct_guard.mjs';
export default { id: 'nexora-direct-offline-fixture', server: async () => {
  const url = new URL(process.env.NEXORA_DIRECT_FIXTURE_URL);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('offline fixture must be loopback');
  const guard = createGuard({ controlURL: process.env.NEXORA_DIRECT_CONTROL_URL, token: process.env.NEXORA_DIRECT_LEASE_TOKEN, key: process.env.NEXORA_DIRECT_PROVIDER_KEY, model: process.env.NEXORA_DIRECT_MODEL, interactive: process.env.NEXORA_DIRECT_HIL === 'true', providerURL: url.href });
  return { config: cfg => guard.configure(cfg), 'chat.params': (i,o) => guard.params(i,o), 'tool.execute.before': i => guard.tool(i), 'shell.env': () => { throw new Error('opencode_direct_tool_denied'); } };
} };
