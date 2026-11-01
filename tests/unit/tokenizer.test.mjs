// Tokenizer contract: Qwen2.5 byte-level BPE must reproduce Hugging Face `tokenizers` ids exactly, and the chat
// prompt count must equal the prompt_tokens Ollama reported for qwen2.5:0.5b (fixtures/tokenizer-cases.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qwenTokenizer } from '../../src/adapters/qwen-tokenizer.mjs';
import { renderQwenChat } from '../../src/domain/chat.mjs';

const fx = JSON.parse(readFileSync(new URL('../fixtures/tokenizer-cases.json', import.meta.url), 'utf8'));
const tok = qwenTokenizer();

test('T1 encode() matches the reference ids for every fixture text', () => {
  assert.ok(fx.cases.length >= 30);
  for (const c of fx.cases) assert.deepEqual(tok.encode(c.text), c.ids, JSON.stringify(c.text));
});

test('T2 special tokens in the rendered template count as one token each', () => {
  assert.equal(tok.countPrompt('<|im_start|>user\nHello<|im_end|>\n'), 1 + tok.encode('user\nHello').length + 1 + 1);
});

test('T3 chat input tokens equal Ollama-observed prompt_tokens', () => {
  for (const c of fx.chats.cases) assert.equal(tok.countPrompt(renderQwenChat(c.messages)), c.inputTokens, JSON.stringify(c.messages));
});

test('T4 differential: 3350 whitespace/format-heavy texts match the reference ids exactly', () => {
  const diff = JSON.parse(readFileSync(new URL('../fixtures/tokenizer-differential.json', import.meta.url), 'utf8'));
  assert.equal(diff.length, 3350);
  const bad = diff.filter((c) => JSON.stringify(tok.encode(c.text)) !== JSON.stringify(c.ids));
  assert.equal(bad.length, 0, `first mismatch: ${JSON.stringify(bad[0]?.text)}`);
});
