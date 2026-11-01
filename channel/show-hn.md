# Draft: Show HN (NOT POSTED; owner confirms eligibility first)

Title: Show HN: Per-user request and token limits in front of an LLM, refused before the call

URL: <public repository URL, UNRESOLVED>

First comment:

[OWNER: one or two sentences in your own words on why you built this, or delete this line. Do not post an
invented story.]

llm-user-limits is a small Node.js gateway (standard library only) that gives each user a request limit and a
token budget per time window. When a request would go over, it answers 429 before calling the model.

How it works: the gateway counts the input tokens itself with the model's tokenizer (Qwen2.5 BPE in plain
JavaScript), adds the request's max_tokens, and reserves both in one synchronous step. That way two parallel
requests cannot both take the last allowance; the HTTP tests send 25 parallel requests against a limit of 5 and
check that exactly 5 reach the upstream. The count matched the prompt_tokens Ollama reported in every case we
checked.

You can try it in a few minutes with the bundled stub upstream (no key, no account), or with Ollama and
qwen2.5:0.5b.

Limits, plainly: one model only (the token count is exact only for its tokenizer), counters in memory (restart
resets them), the user id is a header the gateway trusts (it is not authentication), and quota is charged at
max_tokens, not actual usage.

It was built with AI coding agents under the direction of [OWNER]. MIT licensed. Feedback on the accounting
model is welcome, and so are ideas for adding other tokenizers without pulling in dependencies.
