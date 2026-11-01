// Use case with in-memory ports: order of checks and the no-upstream-on-refusal rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../../src/app/gateway.mjs';
import { createLimiter } from '../../src/domain/limits.mjs';
import { memoryStore } from '../../src/adapters/memory-store.mjs';

const MODEL = 'qwen2.5:0.5b';
function setup(cfg = {}) {
  const calls = [];
  const config = { model: MODEL, maxOutputTokens: 256, maxInputTokens: 8192, ...cfg };
  const gw = createGateway({
    config,
    tokenizer: { countPrompt: () => 10 },
    limiter: createLimiter({ limits: { maxRequests: 100, maxTokens: Number.MAX_SAFE_INTEGER, windowSeconds: 60 }, store: memoryStore(), clock: { now: () => 0 } }),
    upstream: { chat: async (r) => { calls.push(r); return { ok: true, body: {} }; } },
  });
  return { gw, calls };
}

test('G1 a reservation beyond safe-integer range is a 400, not a crash, and never reaches the upstream', async () => {
  const { gw, calls } = setup({ maxOutputTokens: Number.MAX_SAFE_INTEGER });
  const r = await gw.handle({ userId: 'u', body: { model: MODEL, max_tokens: Number.MAX_SAFE_INTEGER, messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'invalid_request');
  assert.equal(calls.length, 0);
});

test('G2 allowed request forwards exactly one upstream call with the parsed request', async () => {
  const { gw, calls } = setup();
  const r = await gw.handle({ userId: 'u', body: { model: MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-gateway-reserved-tokens'], '15');
  assert.deepEqual(calls, [{ model: MODEL, maxTokens: 5, messages: [{ role: 'user', content: 'x' }] }]);
});
