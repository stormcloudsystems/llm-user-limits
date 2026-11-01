// Qwen2.5 tokenizer (byte-level BPE), stdlib only. Data: data/qwen2.5-tokenizer.json.gz = vocab + merges + added
// tokens from Qwen/Qwen2.5-0.5B-Instruct tokenizer.json (Apache-2.0, see data/NOTICE). Pipeline as in that file:
// NFC normalize -> split with the Qwen2 pre-tokenizer regex -> map bytes to GPT-2 byte-level symbols -> BPE merges.
// Verified against Hugging Face `tokenizers` ids (tests/unit/tokenizer.test.mjs T1) and Ollama prompt_tokens (T3).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DATA = new URL('../../data/qwen2.5-tokenizer.json.gz', import.meta.url);
// Qwen2 pre-tokenizer pattern; the (?i:...) group is written out for ASCII letters.
// `\s` is written as \p{White_Space} because the reference (Rust regex) uses Unicode White_Space, while
// JavaScript's \s differs (it includes U+FEFF and excludes U+0085).
const WS = '\\p{White_Space}';
const SPLIT = new RegExp(`'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^${WS}\\p{L}\\p{N}]+[\\r\\n]*|${WS}*[\\r\\n]+|${WS}+(?![^${WS}])|${WS}+`, 'gu');

function byteToUnicode() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const map = new Array(256);
  bs.forEach((b, i) => { map[b] = String.fromCodePoint(cs[i]); });
  return map;
}

export function qwenTokenizer(path = DATA) {
  const { vocab, merges, added_tokens: added } = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
  const ranks = new Map(merges.map((m, i) => [m, i]));
  const b2u = byteToUnicode();
  const cache = new Map();
  const specials = new RegExp(`(${Object.keys(added).map((s) => s.replace(/[|<>/]/g, '\\$&')).join('|')})`);

  function bpe(word) {
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      const a = parts[best];
      const b = parts[best + 1];
      const next = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) { next.push(a + b); i++; } else next.push(parts[i]);
      }
      parts = next;
    }
    return parts.map((p) => {
      const id = vocab[p];
      if (id === undefined) throw new Error('tokenizer: symbol not in vocabulary');
      return id;
    });
  }

  function encodeOrdinary(text, ids) {
    for (const [piece] of text.normalize('NFC').matchAll(SPLIT)) {
      let out = cache.get(piece);
      if (!out) {
        out = bpe([...Buffer.from(piece, 'utf8')].map((b) => b2u[b]).join(''));
        if (cache.size < 50_000) cache.set(piece, out);
      }
      for (const id of out) ids.push(id);
    }
  }

  // Like Hugging Face `tokenizers`: added/special tokens (e.g. <|im_start|>) are matched first, one id each.
  function encode(text) {
    const ids = [];
    for (const part of text.split(specials)) {
      if (!part) continue;
      if (Object.hasOwn(added, part)) ids.push(added[part]);
      else encodeOrdinary(part, ids);
    }
    return ids;
  }

  const countPrompt = (prompt) => encode(prompt).length;

  return { encode, countPrompt };
}
