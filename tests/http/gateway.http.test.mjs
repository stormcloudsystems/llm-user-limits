// F3 acceptance over real HTTP: real gateway process -> real HTTP upstream adapter -> bundled stub process.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, req } from './helpers.mjs';
import { qwenTokenizer } from '../../src/adapters/qwen-tokenizer.mjs';
import { renderQwenChat } from '../../src/domain/chat.mjs';

const tok = qwenTokenizer();
const inputTokens = (content) => tok.countPrompt(renderQwenChat([{ role: 'user', content }]));
const stacks = [];
const stack = async (env) => { const s = await startStack(env); stacks.push(s); return s; };
after(() => stacks.forEach((s) => s.stop()));

test('F3-A request limit: boundary succeeds, next -> 429 request_limit_exceeded, upstream count unchanged', async () => {
  const s = await stack({ MAX_REQUESTS: '3', MAX_TOKENS: '100000' });
  for (let i = 0; i < 3; i++) assert.equal((await s.chat('alice', req())).status, 200);
  const before = (await s.upstreamCalls()).count;
  const r = await s.chat('alice', req());
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'request_limit_exceeded');
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  assert.equal((await s.upstreamCalls()).count, before);
  assert.equal(before, 3);
});

test('F3-A/E token limit: reservation = local input tokens + max_tokens; exact boundary ok, +1 refused pre-upstream', async () => {
  const cost = inputTokens('hi') + 8;
  const s = await stack({ MAX_REQUESTS: '100', MAX_TOKENS: String(cost * 2) });
  const r1 = await s.chat('bob', req('hi', 8));
  assert.equal(r1.status, 200);
  assert.equal(Number(r1.headers.get('x-gateway-reserved-tokens')), cost);
  assert.equal((await s.chat('bob', req('hi', 8))).status, 200);
  const r3 = await s.chat('bob', req('hi', 1));
  assert.equal(r3.status, 429);
  assert.equal(r3.json.error.code, 'token_limit_exceeded');
  assert.equal((await s.upstreamCalls()).count, 2);
});

test('F3-B budgets independent and users isolated', async () => {
  const s = await stack({ MAX_REQUESTS: '2', MAX_TOKENS: '100000' });
  await s.chat('a', req()); await s.chat('a', req());
  assert.equal((await s.chat('a', req())).json.error.code, 'request_limit_exceeded');
  assert.equal((await s.chat('b', req())).status, 200);
});

test('F3-B invalid identity, counts, payloads, unsupported inputs -> 4xx without upstream call', async () => {
  const s = await stack({ MAX_REQUESTS: '100', MAX_TOKENS: '100000', MAX_OUTPUT_TOKENS: '256', MAX_BODY_BYTES: '4096' });
  const cases = [
    [null, req(), 400, 'invalid_user'],
    ['bad user', req(), 400, 'invalid_user'],
    ['u', { ...req(), max_tokens: -1 }, 400, 'invalid_request'],
    ['u', { ...req(), max_tokens: 'NaN' }, 400, 'invalid_request'],
    ['u', '{"model":"qwen2.5:0.5b","max_tokens":1e400,"messages":[{"role":"user","content":"x"}]}', 400, 'invalid_request'],
    ['u', { ...req(), max_tokens: 9007199254740993 }, 400, 'invalid_request'],
    ['u', { model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: 'x' }] }, 400, 'invalid_request'],
    ['u', { ...req(), max_tokens: 257 }, 400, 'invalid_request'],
    ['u', { ...req(), model: 'gpt-4o' }, 400, 'unsupported_model'],
    ['u', { ...req(), stream: true }, 400, 'unsupported_feature'],
    ['u', { ...req(), tools: [{ type: 'function' }] }, 400, 'unsupported_feature'],
    ['u', { ...req(), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }, 400, 'unsupported_feature'],
    ['u', { ...req(), input_tokens: 1 }, 400, 'unsupported_feature'],
    ['u', '{not json', 400, 'invalid_request'],
    ['u', req('x'.repeat(5000)), 413, 'payload_too_large'],
  ];
  for (const [u, b, st, code] of cases) {
    const r = await s.chat(u, b);
    assert.equal(r.status, st, `${code} ${JSON.stringify(b).slice(0, 80)}`);
    assert.equal(r.json.error.code, code);
  }
  assert.equal((await s.upstreamCalls()).count, 0);
});

test('F3-B input over MAX_INPUT_TOKENS -> 400 input_too_large without upstream call', async () => {
  const s = await stack({ MAX_REQUESTS: '100', MAX_TOKENS: '100000', MAX_INPUT_TOKENS: '40' });
  assert.equal((await s.chat('u', req('hi'))).status, 200);
  const r = await s.chat('u', req('word '.repeat(30)));
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'input_too_large');
  assert.equal((await s.upstreamCalls()).count, 1);
});

test('F3-B a request whose reservation alone exceeds the budget is refused before upstream', async () => {
  const s = await stack({ MAX_REQUESTS: '100', MAX_TOKENS: '50', MAX_OUTPUT_TOKENS: '256' });
  const r = await s.chat('u', req('hi', 200));
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'token_limit_exceeded');
  assert.equal((await s.upstreamCalls()).count, 0);
});

test('F3-C concurrent requests at the request boundary: exactly the allowance passes', async () => {
  const s = await stack({ MAX_REQUESTS: '5', MAX_TOKENS: '1000000' });
  const rs = await Promise.all(Array.from({ length: 25 }, () => s.chat('c', req('hi', 4))));
  assert.equal(rs.filter((r) => r.status === 200).length, 5);
  assert.equal(rs.filter((r) => r.status === 429).length, 20);
  assert.equal((await s.upstreamCalls()).count, 5);
});

test('F3-C concurrent requests at the token boundary: only one can take the last allowance', async () => {
  const cost = inputTokens('slow:300') + 10;
  const s = await stack({ MAX_REQUESTS: '1000', MAX_TOKENS: String(cost * 3) });
  assert.equal((await s.chat('d', req('slow:300', 10))).status, 200);
  assert.equal((await s.chat('d', req('slow:300', 10))).status, 200);
  const rs = await Promise.all(Array.from({ length: 20 }, () => s.chat('d', req('slow:300', 10))));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.ok(rs.filter((r) => r.status === 429).every((r) => r.json.error.code === 'token_limit_exceeded'));
  assert.equal((await s.upstreamCalls()).count, 3);
});

test('F3-D fixed window resets over real time (2 s window)', async () => {
  const s = await stack({ MAX_REQUESTS: '1', MAX_TOKENS: '100000', WINDOW_SECONDS: '2' });
  // start right after a window boundary so both requests fall in the same window
  await new Promise((r) => setTimeout(r, 2000 - (Date.now() % 2000) + 50));
  assert.equal((await s.chat('w', req())).status, 200);
  assert.equal((await s.chat('w', req())).status, 429);
  await new Promise((r) => setTimeout(r, 2000 - (Date.now() % 2000) + 50));
  assert.equal((await s.chat('w', req())).status, 200);
});

test('F3-D upstream timeout -> 504, upstream failure -> 502; quota is not given back', async () => {
  const s = await stack({ MAX_REQUESTS: '3', MAX_TOKENS: '100000', UPSTREAM_TIMEOUT_MS: '500' });
  const t = await s.chat('f', req('slow:2000'));
  assert.equal(t.status, 504);
  assert.equal(t.json.error.code, 'upstream_timeout');
  const e = await s.chat('f', req('fail:500'));
  assert.equal(e.status, 502);
  assert.equal(e.json.error.code, 'upstream_error');
  assert.equal((await s.chat('f', req())).status, 200);
  assert.equal((await s.chat('f', req())).json.error.code, 'request_limit_exceeded');
});

test('F3-E the upstream receives exactly the fixed model, messages and max_tokens; output respects the cap', async () => {
  const s = await stack({ MAX_REQUESTS: '10', MAX_TOKENS: '100000' });
  const r = await s.chat('e', req('hello there', 7, { temperature: 0 }));
  assert.equal(r.status, 200);
  const { last } = await s.upstreamCalls();
  assert.deepEqual(last.body, { model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: 'hello there' }], max_tokens: 7, stream: false, temperature: 0 });
  assert.equal(last.path, '/v1/chat/completions');
  assert.ok(r.json.usage.completion_tokens <= 7);
  assert.equal(r.json.choices[0].finish_reason, 'length');
});

test('F3 the upstream target cannot be chosen by the caller', async () => {
  const s = await stack({ MAX_REQUESTS: '10', MAX_TOKENS: '100000' });
  const r = await s.chat('g', req(), { host: 'evil.example', 'x-upstream-url': 'http://evil.example/v1' });
  assert.equal(r.status, 200);
  assert.equal((await s.upstreamCalls()).count, 1);
});

test('F3 only POST /v1/chat/completions exists; gateway binds loopback by default', async () => {
  const s = await stack({});
  assert.equal((await fetch(`${s.base}/v1/models`)).status, 404);
  assert.match(s.base, /127\.0\.0\.1/);
});
