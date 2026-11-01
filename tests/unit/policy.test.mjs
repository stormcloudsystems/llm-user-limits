// Limit policy (pure domain): fixed window, per-user request + token budgets, atomic reserve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, windowStart } from '../../src/domain/limits.mjs';
import { memoryStore } from '../../src/adapters/memory-store.mjs';

const limits = { maxRequests: 3, maxTokens: 100, windowSeconds: 60 };
const mk = (now = 1_000_000_000_000, l = limits) => {
  const clock = { now: () => now, set: (t) => (now = t) };
  return { clock, lim: createLimiter({ limits: l, store: memoryStore(), clock }) };
};

test('P1 windows are aligned to epoch multiples of windowSeconds', () => {
  assert.equal(windowStart(125_000, 60), 120_000);
  assert.equal(windowStart(119_999, 60), 60_000);
});

test('P2 request limit: boundary request allowed, next refused with request_limit_exceeded', () => {
  const { lim } = mk();
  for (let i = 0; i < 3; i++) assert.equal(lim.reserve('a', 1).ok, true);
  const r = lim.reserve('a', 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'request_limit_exceeded');
  assert.ok(r.retryAfterSeconds >= 1 && r.retryAfterSeconds <= 60);
});

test('P3 token limit: exact boundary allowed, one more token refused with token_limit_exceeded', () => {
  const { lim } = mk(undefined, { maxRequests: 10, maxTokens: 100, windowSeconds: 60 });
  assert.equal(lim.reserve('a', 60).ok, true);
  assert.equal(lim.reserve('a', 40).ok, true);
  const r = lim.reserve('a', 1);
  assert.equal(r.code, 'token_limit_exceeded');
});

test('P4 a refused reservation consumes nothing', () => {
  const { lim } = mk(undefined, { maxRequests: 10, maxTokens: 100, windowSeconds: 60 });
  assert.equal(lim.reserve('a', 101).code, 'token_limit_exceeded');
  assert.equal(lim.reserve('a', 100).ok, true);
  assert.deepEqual(lim.usage('a'), { requests: 1, tokens: 100 });
});

test('P5 budgets are independent: request limit hit with tokens left, and vice versa', () => {
  const { lim } = mk();
  for (let i = 0; i < 3; i++) lim.reserve('a', 1);
  assert.equal(lim.reserve('a', 1).code, 'request_limit_exceeded');
  assert.equal(lim.reserve('b', 100).ok, true);
  assert.equal(lim.reserve('b', 1).code, 'token_limit_exceeded');
});

test('P6 users are isolated', () => {
  const { lim } = mk();
  for (let i = 0; i < 3; i++) lim.reserve('a', 1);
  assert.equal(lim.reserve('a', 1).ok, false);
  assert.equal(lim.reserve('b', 1).ok, true);
});

test('P7 fixed window resets at the next boundary (injected clock)', () => {
  const { clock, lim } = mk(60_000 * 1000 + 59_999);
  for (let i = 0; i < 3; i++) lim.reserve('a', 10);
  assert.equal(lim.reserve('a', 1).ok, false);
  clock.set(60_000 * 1001);
  assert.equal(lim.reserve('a', 1).ok, true);
  assert.deepEqual(lim.usage('a'), { requests: 1, tokens: 1 });
});

test('P8 invalid token amounts are rejected by the policy (no NaN/negative/overflow accounting)', () => {
  const { lim } = mk();
  for (const n of [0, -1, NaN, Infinity, 1.5, '5', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => lim.reserve('a', n), /tokens/);
  assert.deepEqual(lim.usage('a'), { requests: 0, tokens: 0 });
});

test('P9 invalid limit configuration fails fast', () => {
  for (const l of [{ ...limits, maxRequests: 0 }, { ...limits, maxTokens: -1 }, { ...limits, windowSeconds: 1.5 }])
    assert.throws(() => createLimiter({ limits: l, store: memoryStore(), clock: { now: () => 0 } }));
});
