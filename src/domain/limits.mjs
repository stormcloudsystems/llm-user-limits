// Per-user limit policy: pure, no I/O. One fixed window (aligned to epoch multiples of windowSeconds),
// a request budget and a token budget per user. reserve() checks both and records both in one step, so a
// refused request consumes nothing and two callers can never both take the last allowance (the store's
// update runs synchronously; see memory-store.mjs).
// Ports: store.update(key, fn) applies fn to the current record atomically; clock.now() returns epoch ms.

export function windowStart(nowMs, windowSeconds) {
  const w = windowSeconds * 1000;
  return Math.floor(nowMs / w) * w;
}

const posInt = (v) => Number.isSafeInteger(v) && v > 0;

export function createLimiter({ limits, store, clock }) {
  const { maxRequests, maxTokens, windowSeconds } = limits || {};
  if (!posInt(maxRequests) || !posInt(maxTokens) || !posInt(windowSeconds)) {
    throw new Error('limits: maxRequests, maxTokens and windowSeconds must be positive integers');
  }
  const current = (rec, start) => (rec && rec.start === start ? rec : { start, requests: 0, tokens: 0 });

  return {
    // Reserve one request and `tokens` tokens for `userId` in the current window.
    reserve(userId, tokens) {
      if (!posInt(tokens)) throw new Error('tokens must be a positive safe integer');
      const now = clock.now();
      const start = windowStart(now, windowSeconds);
      const retryAfterSeconds = Math.max(1, Math.ceil((start + windowSeconds * 1000 - now) / 1000));
      let verdict;
      store.update(userId, (prev) => {
        const rec = current(prev, start);
        if (rec.requests + 1 > maxRequests) { verdict = { ok: false, code: 'request_limit_exceeded', retryAfterSeconds }; return rec; }
        if (rec.tokens + tokens > maxTokens) { verdict = { ok: false, code: 'token_limit_exceeded', retryAfterSeconds }; return rec; }
        verdict = { ok: true };
        return { start, requests: rec.requests + 1, tokens: rec.tokens + tokens };
      });
      return verdict;
    },
    usage(userId) {
      const rec = current(store.get(userId), windowStart(clock.now(), windowSeconds));
      return { requests: rec.requests, tokens: rec.tokens };
    },
  };
}
