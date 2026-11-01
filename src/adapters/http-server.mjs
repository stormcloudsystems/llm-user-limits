// Inbound adapter: node:http server exposing POST /v1/chat/completions only. Reads at most maxBodyBytes.
import { createServer } from 'node:http';

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const error = (code, message) => ({ error: { code, message } });

export function createHttpServer({ gateway, maxBodyBytes }) {
  return createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(res, 404, error('not_found', 'only POST /v1/chat/completions'));
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBodyBytes) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (tooBig) return send(res, 413, error('payload_too_large', `body larger than ${maxBodyBytes} bytes`), { connection: 'close' });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, error('invalid_request', 'body is not valid JSON')); }
      try {
        const out = await gateway.handle({ userId: req.headers['x-user-id'], body });
        send(res, out.status, out.body, out.headers);
      } catch (e) {
        send(res, 500, error('internal_error', 'gateway error'));
        console.error(e);
      }
    });
  });
}
