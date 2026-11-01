// Chat request schema, user identity and the Qwen2.5 chat prompt. Pure, no I/O.
// Supported: non-streaming, text-only chat for ONE configured model. Everything else is refused explicitly.

const ALLOWED = new Set(['model', 'messages', 'max_tokens', 'stream', 'temperature']);
const KNOWN_UNSUPPORTED = new Set(['tools', 'tool_choice', 'functions', 'function_call', 'response_format', 'logprobs',
  'top_logprobs', 'n', 'stream_options', 'max_completion_tokens', 'audio', 'modalities', 'parallel_tool_calls']);
const SPECIAL = /<\|[a-z_]+\|>|<\/?tool_call>/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// Ollama's default system prompt for qwen2.5 (used when the request has none, so the count matches what runs).
export const QWEN_DEFAULT_SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';

const bad = (code, message) => ({ ok: false, code, message });

export function parseUserId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : null;
}

export function parseChatRequest(body, { model, maxOutputTokens }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('invalid_request', 'body must be a JSON object');
  for (const k of Object.keys(body)) {
    if (!ALLOWED.has(k)) return bad(KNOWN_UNSUPPORTED.has(k) || !/^[a-z_]+$/.test(k) ? 'unsupported_feature' : 'unsupported_feature', `field not supported: ${k}`);
  }
  if (body.model !== model) return bad('unsupported_model', `only model "${model}" is supported`);
  if (body.stream !== undefined && body.stream !== false) return bad('unsupported_feature', 'streaming is not supported');
  const mt = body.max_tokens;
  if (!Number.isSafeInteger(mt) || mt < 1 || mt > maxOutputTokens) return bad('invalid_request', `max_tokens must be an integer from 1 to ${maxOutputTokens}`);
  if (body.temperature !== undefined && !(typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2)) {
    return bad('invalid_request', 'temperature must be a number from 0 to 2');
  }
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return bad('invalid_request', 'messages must be a non-empty array');
  const messages = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || typeof m !== 'object' || Array.isArray(m)) return bad('invalid_request', 'each message must be an object');
    for (const k of Object.keys(m)) if (k !== 'role' && k !== 'content') return bad('unsupported_feature', `message field not supported: ${k}`);
    if (typeof m.content !== 'string') {
      return Array.isArray(m.content) ? bad('unsupported_feature', 'only text content (a string) is supported') : bad('invalid_request', 'content must be a string');
    }
    if (!['system', 'user', 'assistant'].includes(m.role)) return bad('invalid_request', 'role must be system, user or assistant');
    if (m.role === 'system' && i !== 0) return bad('invalid_request', 'a system message is only allowed first');
    if (SPECIAL.test(m.content) || LONE_SURROGATE.test(m.content)) return bad('invalid_request', 'content contains control-token text or invalid Unicode');
    messages.push({ role: m.role, content: m.content });
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === messages[i - 1].role) return bad('invalid_request', 'two messages in a row have the same role; combine them');
  }
  if (messages[messages.length - 1].role !== 'user') return bad('invalid_request', 'the last message must be from the user');
  const value = { model, maxTokens: mt, messages };
  if (body.temperature !== undefined) value.temperature = body.temperature;
  return { ok: true, value };
}

// Renders messages exactly like the qwen2.5 chat template shipped with Ollama 0.40.3 (no tools).
export function renderQwenChat(messages) {
  const sys = messages[0] && messages[0].role === 'system' ? messages[0].content : QWEN_DEFAULT_SYSTEM;
  const rest = messages[0] && messages[0].role === 'system' ? messages.slice(1) : messages;
  let out = `<|im_start|>system\n${sys}<|im_end|>\n`;
  for (const m of rest) out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  return `${out}<|im_start|>assistant\n`;
}
