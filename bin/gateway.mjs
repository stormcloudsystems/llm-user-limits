#!/usr/bin/env node
// llm-user-limits gateway: wires the adapters to the use case and starts listening (127.0.0.1 by default).
import { loadConfig } from '../src/adapters/config.mjs';
import { qwenTokenizer } from '../src/adapters/qwen-tokenizer.mjs';
import { memoryStore } from '../src/adapters/memory-store.mjs';
import { httpUpstream } from '../src/adapters/upstream-http.mjs';
import { createHttpServer } from '../src/adapters/http-server.mjs';
import { createLimiter } from '../src/domain/limits.mjs';
import { createGateway } from '../src/app/gateway.mjs';

let config;
try { config = loadConfig(); } catch (e) { console.error(`config error: ${e.message}`); process.exit(2); }
if (config.model !== 'qwen2.5:0.5b') { console.error('config error: this version only supports MODEL=qwen2.5:0.5b (its tokenizer is the one bundled)'); process.exit(2); }
const gateway = createGateway({
  config,
  tokenizer: qwenTokenizer(),
  limiter: createLimiter({ limits: config.limits, store: memoryStore(), clock: { now: () => Date.now() } }),
  upstream: httpUpstream({ baseUrl: config.upstreamUrl, apiKey: config.upstreamApiKey, timeoutMs: config.upstreamTimeoutMs }),
  log: (e) => console.log(JSON.stringify({ t: new Date().toISOString(), ...e })),
});
createHttpServer({ gateway, maxBodyBytes: config.maxBodyBytes }).listen(config.port, config.host, () => {
  const { maxRequests, maxTokens, windowSeconds } = config.limits;
  console.log(`llm-user-limits listening on http://${config.host}:${config.port} -> ${new URL(config.upstreamUrl).origin} | ` +
    `per user: ${maxRequests} requests and ${maxTokens} tokens per ${windowSeconds} s window (in memory)`);
});
