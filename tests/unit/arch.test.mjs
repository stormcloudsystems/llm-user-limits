// Hexagonal boundary: domain imports nothing; app imports only domain; nothing but adapters touches node:http/fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;
const files = (d) => readdirSync(join(SRC, d)).filter((f) => f.endsWith('.mjs')).map((f) => [f, readFileSync(join(SRC, d, f), 'utf8')]);

test('A1 domain has no imports and no I/O', () => {
  for (const [f, s] of files('domain')) {
    assert.doesNotMatch(s, /^\s*import\s/m, f);
    assert.doesNotMatch(s, /\bfetch\(|process\.|require\(/, f);
  }
});

test('A2 app depends only on domain and injected ports', () => {
  for (const [f, s] of files('app')) for (const m of s.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.\.\/domain\//, `${f} -> ${m[1]}`);
});
