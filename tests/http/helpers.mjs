// Starts the REAL gateway and the bundled stub upstream as separate processes on free loopback ports.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

function start(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => reject(new Error(`${script} did not start: ${out}`)), 15000);
    const on = (d) => { out += d; if (/listening on/.test(out)) { clearTimeout(t); resolve(p); } };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('exit', (c) => { clearTimeout(t); reject(new Error(`${script} exited ${c}: ${out}`)); });
  });
}

export async function startStack(gwEnv = {}) {
  const sp = await freePort();
  const gp = await freePort();
  const stub = await start('stub/upstream-stub.mjs', { PORT: String(sp) });
  const gw = await start('bin/gateway.mjs', { PORT: String(gp), UPSTREAM_URL: `http://127.0.0.1:${sp}/v1`, ...gwEnv });
  const base = `http://127.0.0.1:${gp}`;
  const stubBase = `http://127.0.0.1:${sp}`;
  return {
    base, stubBase,
    chat: async (user, body, extraHeaders = {}) => {
      const headers = { 'content-type': 'application/json', ...extraHeaders };
      if (user !== null) headers['x-user-id'] = user;
      const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
    },
    upstreamCalls: async () => (await (await fetch(`${stubBase}/__calls`)).json()),
    stop: () => { gw.kill(); stub.kill(); },
  };
}

export const MODEL = 'qwen2.5:0.5b';
export const req = (content = 'hi', max = 8, extra = {}) => ({ model: MODEL, max_tokens: max, messages: [{ role: 'user', content }], ...extra });
