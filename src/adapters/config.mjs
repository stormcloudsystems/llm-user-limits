// Reads configuration from environment variables. Fails fast on anything invalid.
const int = (env, k, d) => {
  const raw = env[k] ?? String(d);
  const v = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(v) || v < 1) throw new Error(`${k} must be a positive integer (got "${raw}")`);
  return v;
};

export function loadConfig(env = process.env) {
  if (!env.UPSTREAM_URL || !/^https?:\/\//.test(env.UPSTREAM_URL)) throw new Error('UPSTREAM_URL must be set to an http(s) URL, e.g. http://127.0.0.1:8081/v1');
  return {
    host: env.HOST || '127.0.0.1',
    port: int(env, 'PORT', 8080),
    upstreamUrl: env.UPSTREAM_URL,
    upstreamApiKey: env.UPSTREAM_API_KEY || '',
    upstreamTimeoutMs: int(env, 'UPSTREAM_TIMEOUT_MS', 60000),
    model: env.MODEL || 'qwen2.5:0.5b',
    maxOutputTokens: int(env, 'MAX_OUTPUT_TOKENS', 1024),
    maxInputTokens: int(env, 'MAX_INPUT_TOKENS', 8192),
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 65536),
    limits: { maxRequests: int(env, 'MAX_REQUESTS', 20), maxTokens: int(env, 'MAX_TOKENS', 20000), windowSeconds: int(env, 'WINDOW_SECONDS', 3600) },
  };
}
