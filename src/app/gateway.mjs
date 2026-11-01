// Use case: admit one chat request for one user, then forward it. Ports (injected):
//   tokenizer.countPrompt(text) -> int, limiter.reserve(user, tokens), upstream.chat(request) -> result.
// Order is the contract: validate -> count input locally -> reserve (input + max_tokens) atomically -> call upstream.
// A refused or invalid request never reaches the upstream. A reservation is never given back (also on failure).
import { parseChatRequest, parseUserId, renderQwenChat } from '../domain/chat.mjs';

const err = (status, code, message, headers = {}) => ({ status, headers, body: { error: { code, message } } });

export function createGateway({ config, tokenizer, limiter, upstream, log = () => {} }) {
  return {
    async handle({ userId: rawUser, body }) {
      const userId = parseUserId(rawUser);
      if (!userId) return err(400, 'invalid_user', 'x-user-id header must be 1-64 characters [A-Za-z0-9._-]');
      const parsed = parseChatRequest(body, config);
      if (!parsed.ok) return err(400, parsed.code, parsed.message);
      const req = parsed.value;

      const inputTokens = tokenizer.countPrompt(renderQwenChat(req.messages));
      if (inputTokens > config.maxInputTokens) return err(400, 'input_too_large', `input is ${inputTokens} tokens; the limit is ${config.maxInputTokens}`);
      const reserved = inputTokens + req.maxTokens;
      if (!Number.isSafeInteger(reserved)) return err(400, 'invalid_request', 'max_tokens is too large');

      const verdict = limiter.reserve(userId, reserved);
      if (!verdict.ok) {
        log({ event: 'refused', userId, code: verdict.code, reserved });
        return err(429, verdict.code, verdict.code === 'request_limit_exceeded' ? 'request limit for this window reached' : 'token budget for this window reached',
          { 'retry-after': String(verdict.retryAfterSeconds) });
      }
      const headers = { 'x-gateway-reserved-tokens': String(reserved), 'x-gateway-input-tokens': String(inputTokens) };
      const res = await upstream.chat(req);
      log({ event: res.ok ? 'forwarded' : 'upstream_failed', userId, reserved, kind: res.kind });
      if (!res.ok) return res.kind === 'timeout' ? err(504, 'upstream_timeout', 'upstream did not answer in time', headers) : err(502, 'upstream_error', res.error, headers);
      return { status: 200, headers, body: res.body };
    },
  };
}
