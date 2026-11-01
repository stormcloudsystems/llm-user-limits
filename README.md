# llm-user-limits

A small Node.js gateway that sits in front of an LLM server and gives each user a request limit and a token
budget per time window. Requests over the limit get HTTP 429 **before** anything is sent to the model, so they
cost nothing upstream.

Free and MIT-licensed, from Storm Cloud Systems. Node.js standard library only (no `npm install`).

## Try it in 5 minutes (no account, no API key)

Prerequisites: Node.js 22 or later and `curl`. Get a copy of this repository (`git clone` it, or download and
unpack it). Uses the bundled stub upstream, which returns canned text (it is not a model).

```sh
cd llm-user-limits

# terminal 1: the stub upstream
node stub/upstream-stub.mjs

# terminal 2: the gateway, 2 requests per user per hour
UPSTREAM_URL=http://127.0.0.1:8081/v1 MAX_REQUESTS=2 node bin/gateway.mjs

# terminal 3: three requests as user "alice"
for i in 1 2 3; do
  curl -s -w ' HTTP %{http_code}\n' http://127.0.0.1:8080/v1/chat/completions \
    -H 'content-type: application/json' -H 'x-user-id: alice' \
    -d '{"model":"qwen2.5:0.5b","max_tokens":16,"messages":[{"role":"user","content":"Hello"}]}'
done
```

The first two answer `HTTP 200` with a stub reply; the third answers `HTTP 429` with
`{"error":{"code":"request_limit_exceeded",...}}`. User `bob` still has a separate budget of two requests.

Measured on 2026-10-20 from a fresh clone with the prerequisites already installed: under one minute of
commands. Typing speed is not included, so allow 5 minutes.

## With a real model (Ollama, still no key)

```sh
ollama pull qwen2.5:0.5b
UPSTREAM_URL=http://127.0.0.1:11434/v1 node bin/gateway.mjs
```

Tested with Ollama 0.40.3 and `qwen2.5:0.5b`. That is the only model and server combination tested.

## How the limits work

Per user and per window, the gateway keeps two counters: requests and tokens. For each request it:

1. Checks the `x-user-id` header and the request body (see "Supported requests").
2. Counts the input tokens itself with the Qwen2.5 tokenizer, over the full chat prompt the model will see.
   The client cannot declare its own count.
3. Reserves **1 request and (input tokens + `max_tokens`)** in one step. If either budget would be exceeded,
   it answers 429 and nothing is reserved or sent.
4. Forwards the request with the same `max_tokens` to the upstream you configured.

The reservation is never given back: a request that fails upstream, or that uses fewer tokens than `max_tokens`,
still counts in full. This is conservative allocated-token accounting, not a measure of actual usage and not
billing.

Windows are fixed and aligned to the clock (for `WINDOW_SECONDS=3600`: every full UTC hour). Counters live in
memory: **restarting the gateway resets every user's quota.**

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `UPSTREAM_URL` | (required) | Base URL of an OpenAI-style server, e.g. `http://127.0.0.1:11434/v1`. Fixed by you; callers cannot change it |
| `UPSTREAM_API_KEY` | empty | Sent as `Authorization: Bearer` if set. Never logged |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | Listen address. Loopback by default |
| `MAX_REQUESTS` | `20` | Requests per user per window |
| `MAX_TOKENS` | `20000` | Tokens (input + `max_tokens`) per user per window |
| `WINDOW_SECONDS` | `3600` | Window length |
| `MAX_OUTPUT_TOKENS` | `1024` | Highest `max_tokens` a request may ask for |
| `MAX_INPUT_TOKENS` | `8192` | Largest input a request may have |
| `MAX_BODY_BYTES` | `65536` | Largest request body |
| `UPSTREAM_TIMEOUT_MS` | `60000` | Upstream timeout |
| `MODEL` | `qwen2.5:0.5b` | The only supported value in this version |

## Supported requests

`POST /v1/chat/completions` only, with header `x-user-id` (1 to 64 characters `A-Z a-z 0-9 . _ -`) and a JSON body:

```json
{ "model": "qwen2.5:0.5b", "max_tokens": 64, "messages": [{ "role": "user", "content": "Hello" }] }
```

- `model` must be `qwen2.5:0.5b`. `max_tokens` is required (integer, 1 to `MAX_OUTPUT_TOKENS`).
  Optional: `temperature` (0 to 2), `stream: false`.
- `messages`: an optional first `system` message, then `user` / `assistant` messages with string content that
  alternate (two messages in a row with the same role are refused, because servers merge them and the count
  would differ); the last one must be `user`.
- Refused with 400 before any upstream call: streaming, tools/functions, images or other non-text content, other
  fields, other models, and text that contains the model's control tokens (for example `<|im_start|>`).

Errors are `{"error":{"code":"...","message":"..."}}`:

| HTTP | `code` |
|---|---|
| 400 | `invalid_user`, `invalid_request`, `unsupported_model`, `unsupported_feature`, `input_too_large` |
| 413 | `payload_too_large` |
| 429 | `request_limit_exceeded`, `token_limit_exceeded` (with a `Retry-After` header) |
| 502 | `upstream_error` |
| 504 | `upstream_timeout` |

Successful responses are passed through from the upstream, plus headers `x-gateway-input-tokens` and
`x-gateway-reserved-tokens`.

## Limitations (read these)

- **`x-user-id` is not authentication.** The gateway trusts whatever the caller sends. Anyone who can pick their
  own user id can get a fresh quota by changing it. Put it behind your own authenticated backend that sets the
  header, or use it locally. Do not expose it to the internet as an abuse-prevention service.
- **One model, one tokenizer.** Token counts are exact only for Qwen2.5 (`qwen2.5:0.5b`) as served by Ollama's
  chat template. Other models use other tokenizers and templates, so this version refuses them.
- **The output cap is enforced by the upstream.** The gateway forwards `max_tokens`; a server that ignores it
  could return more. Ollama 0.40.3 respected it in our tests.
- **In memory, one process.** Quotas reset on restart, and two gateway processes do not share counters.
- Not supported: streaming, tools, images, global (all-user) limits, money/EUR budgets, persistent metering,
  alerts.

## Tests

```sh
node --test 'tests/unit/*.test.mjs'                                  # policy, tokenizer, request schema, architecture
node --test --test-concurrency=1 'tests/http/*.test.mjs'             # real gateway + stub processes over HTTP
REAL_UPSTREAM_URL=http://127.0.0.1:11434/v1 node tests/real-upstream.mjs   # optional, needs Ollama + qwen2.5:0.5b
```

The HTTP tests start the real gateway and the stub as separate processes and check, over real sockets: limits
at the exact boundary, users kept apart, invalid input refused without an upstream call, concurrent requests
unable to share the last allowance (25 parallel requests against a limit of 5: exactly 5 reach the upstream),
window reset, and timeouts/failures that do not give quota back. Stub results show the gateway's behavior,
not a model's.

The tokenizer test compares against token ids from Hugging Face `tokenizers` 0.23.1 for 41 hand-picked texts
(accents, CJK, emoji, code, unusual whitespace) and 3350 generated whitespace-heavy texts, and against the
`prompt_tokens` Ollama 0.40.3 reported for 5 chats. The optional real upstream test checks the same live on 4
chats: local count equal to Ollama's `prompt_tokens`, and output within `max_tokens`.

Tested on 2026-10-20: Linux x86_64, Node.js 26.8.1 and 22.23.3. Other platforms were not tested.

## Want more?

This is a simplified slice of **AI Bill Guardrails**, a paid kit. The kit adds global limits, budgets in EUR with
persistent metering across restarts, cost estimates, alert notifications, a cost-per-user spreadsheet and a
deployment guide.
[AI Bill Guardrails](https://stormcloudsystems.gumroad.com/l/ai-bill-guardrails-010?utm_source=github&utm_medium=free&utm_campaign=scs_launch_202610&utm_content=p3_free)

## License

MIT, see [LICENSE](LICENSE). The bundled tokenizer data in `data/` comes from Qwen2.5 under the Apache License 2.0;
see [data/NOTICE](data/NOTICE).
