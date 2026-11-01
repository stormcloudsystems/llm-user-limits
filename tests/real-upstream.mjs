#!/usr/bin/env node
// Optional check against a REAL OpenAI-compatible server running qwen2.5:0.5b (e.g. local Ollama):
//   REAL_UPSTREAM_URL=http://127.0.0.1:11434/v1 node tests/real-upstream.mjs
// Starts the gateway in front of it and checks: (1) local input-token count == upstream-reported prompt_tokens,
// (2) completion_tokens <= max_tokens, (3) refusal at the limit without an extra upstream call (counted via usage).
// Skips with exit 0 and "SKIPPED" if REAL_UPSTREAM_URL is not set.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './http/helpers.mjs';
import { qwenTokenizer } from '../src/adapters/qwen-tokenizer.mjs';
import { renderQwenChat } from '../src/domain/chat.mjs';

const UP = process.env.REAL_UPSTREAM_URL;
if (!UP) { console.log('SKIPPED: set REAL_UPSTREAM_URL'); process.exit(0); }
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const tok = qwenTokenizer();
const prompts = [
  [{ role: 'user', content: 'Say hello in one short sentence.' }],
  [{ role: 'system', content: 'You answer in German.' }, { role: 'user', content: 'Wie spät ist es in Köln? Antworte kurz.' }],
  [{ role: 'user', content: 'List three colors.' }, { role: 'assistant', content: 'Red, green, blue.' }, { role: 'user', content: 'Three more, please 🙂' }],
  [{ role: 'user', content: '\ufeff.a \u0085 tab\there\u3000end\u2028next' }],
];
const port = await freePort();
const gw = spawn(process.execPath, ['bin/gateway.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH, PORT: String(port), UPSTREAM_URL: UP,
  MAX_REQUESTS: String(prompts.length), MAX_TOKENS: '100000', UPSTREAM_TIMEOUT_MS: '120000' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => gw.stdout.on('data', (d) => /listening on/.test(String(d)) && r()));
let fails = 0;
const post = (messages, max) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user-id': 'real-check' }, body: JSON.stringify({ model: 'qwen2.5:0.5b', max_tokens: max, temperature: 0, messages }) });
for (const [i, m] of prompts.entries()) {
  const max = 12;
  const r = await post(m, max);
  const j = await r.json();
  const local = tok.countPrompt(renderQwenChat(m));
  const ok = r.status === 200 && j.usage.prompt_tokens === local && j.usage.completion_tokens <= max && Number(r.headers.get('x-gateway-reserved-tokens')) === local + max;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} prompt ${i + 1}: status ${r.status}, local input ${local}, upstream prompt_tokens ${j.usage?.prompt_tokens}, ` +
    `completion_tokens ${j.usage?.completion_tokens} <= ${max}, reserved ${r.headers.get('x-gateway-reserved-tokens')}, model ${j.model}`);
}
const r = await post(prompts[0], 12);
const j = await r.json();
const ok = r.status === 429 && j.error.code === 'request_limit_exceeded';
if (!ok) fails++;
console.log(`${ok ? 'PASS' : 'FAIL'} request ${prompts.length + 1}: ${r.status} ${j.error?.code}`);
gw.kill();
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
