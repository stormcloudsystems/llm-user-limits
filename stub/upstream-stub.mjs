#!/usr/bin/env node
// Deterministic local stand-in for an OpenAI-style chat server. NOT a model: it answers with fixed text, at most
// max_tokens "words". Test hooks in the last user message: "slow:<ms>" delays, "fail:<status>" returns that status.
// GET /__calls returns {count, last} so tests can prove whether the gateway called the upstream.
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8081);
let count = 0;
let last = null;
const WORDS = 'this is a deterministic stub reply from the local upstream used for testing only'.split(' ');

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__calls') { res.end(JSON.stringify({ count, last })); return; }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    count += 1;
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end('{}'); return; }
    last = { path: req.url, body };
    const text = String(body.messages?.at(-1)?.content || '');
    const fail = /fail:(\d{3})/.exec(text);
    const slow = /slow:(\d+)/.exec(text);
    const answer = () => {
      if (fail) { res.writeHead(Number(fail[1]), { 'content-type': 'application/json' }); res.end('{"error":"stub failure"}'); return; }
      const n = Math.max(0, Math.min(Number(body.max_tokens) || 0, WORDS.length));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `stub-${count}`, object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: WORDS.slice(0, n).join(' ') }, finish_reason: n < WORDS.length ? 'length' : 'stop' }],
        usage: { prompt_tokens: null, completion_tokens: n, total_tokens: null },
      }));
    };
    if (slow) setTimeout(answer, Number(slow[1])); else answer();
  });
}).listen(port, '127.0.0.1', () => console.log(`stub upstream listening on http://127.0.0.1:${port}/v1`));
