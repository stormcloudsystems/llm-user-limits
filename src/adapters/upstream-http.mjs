// Outbound adapter: OpenAI-style POST {UPSTREAM_URL}/chat/completions. The URL is operator configuration only.
// Sends exactly {model, messages, max_tokens, stream:false[, temperature]}. Optional API key (from the environment)
// is sent as a bearer token and never logged or returned.
export function httpUpstream({ baseUrl, apiKey, timeoutMs, fetchImpl = fetch }) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  return {
    async chat({ model, messages, maxTokens, temperature }) {
      const body = { model, messages, max_tokens: maxTokens, stream: false };
      if (temperature !== undefined) body.temperature = temperature;
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      let res;
      let text;
      try {
        res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
        text = await res.text();
      } catch (e) {
        if (e.name === 'TimeoutError') return { ok: false, kind: 'timeout', error: 'upstream timeout' };
        return { ok: false, kind: 'network', error: `upstream unreachable (${e.cause?.code || e.name})` };
      }
      if (!res.ok) return { ok: false, kind: 'http', error: `upstream returned HTTP ${res.status}` };
      try { return { ok: true, body: JSON.parse(text) }; } catch { return { ok: false, kind: 'bad_response', error: 'upstream returned non-JSON' }; }
    },
  };
}
