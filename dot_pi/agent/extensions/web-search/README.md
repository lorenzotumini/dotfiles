# Web search — Exa free hosted search

`web_search` now calls the documented no-key Exa MCP endpoint:
`https://mcp.exa.ai/mcp`, tool `web_search_exa`.

No account, API key, new npm dependency or general MCP bridge is required for
this implementation. Run `/reload` in Pi to activate it.

## Usage and compatibility

The familiar arguments remain: `query`, `exactPhrases`, `excludeTerms`, `site`,
`count` (integer 1–10, default 5). At least query or a nonempty exact phrase is
required. Inputs and the combined query are bounded.

Phrase/exclusion/site arguments become query hints (`"phrase"`, `-"term"`,
`site:domain/path`). **These are not guaranteed strict filters in Exa.** Verify
source domains, phrases and exclusions rather than assuming Google's operator
semantics. A supplied site URL retains its path but discards query/fragment.

Results are Exa's text blocks containing source titles, URLs and excerpts, not
a locally guaranteed structured list. Requested count may differ from actual
results; metadata reports requestedCount, not an invented result count.
Use `web_fetch` to read selected source URLs, and browser tools when interaction
or local JavaScript rendering is needed.

## Context, network and privacy limits

- Output: **16 KiB / 400 lines**, including a truncation notice; UTF-8 preserved.
- Download: **1 MiB** streamed-body ceiling, regardless of Content-Length.
- Errors: **2 KiB / 20 lines**, with no HTTP error-body dump.
- Deadline: **25 seconds**, including response reading; caller abort supported.
- Accepts JSON or SSE; reads matching JSON-RPC response ID, handles protocol and
  tool errors, and closes the stream after the completed result rather than
  waiting for a persistent SSE connection to end.
- Only small metadata is returned; no hidden full-result objects or temp files.
- The provider is asked for an 8,000-character context, but this is **not trusted
  as an enforced cap**. Local byte/line limits apply independently.
- Only the search query and search options are sent—not session transcripts,
  session IDs, model names or browser cookies. Do not include private code,
  credentials or confidential identifiers in queries.

## Free-service limitations and terms

Exa's documentation describes the hosted MCP free plan as covering casual use.
Availability and quotas may change. A 429 reports the rate limit to the agent;
there are **no automatic retries, paid fallbacks or limit-bypass mechanisms**.
`EXA_API_KEY` and all Google key environment variables are intentionally ignored.
This adapter does not enable usage-based Exa Agent/research tools.

Pi itself saves tool calls and returned text in session logs. This adapter adds
no separate result cache. A review of the public terms did **not establish
blanket permission for indefinite result storage**; the terms contain broad
copying restrictions alongside documented API/MCP use. This is not a legal
clearance for archiving or redistribution. Check applicable terms/permissions
for your use, especially commercial retention or redistribution. Exa's terms
also permit certain input/output use for operating and improving its services.

References checked during setup:
- https://exa.ai/docs/reference/exa-mcp
- https://exa.ai/terms
- https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/mcp-websearch.ts

The adapter follows the documented hosted-tool approach also used by OpenCode;
it is not a search-engine scraper.

## Legacy Google configuration

Google credentials are no longer needed or read. The old `auth.example.json`
file is retained only as a legacy reference and is **not** an Exa setup step.
No existing credential files or global Pi authentication settings were changed.

This change does not modify web-fetch, including its current Jina fallback.

## Tests

```bash
npm --prefix ~/.pi/agent/extensions/web-search test
```

Offline tests use synthetic responses to cover query validation, no-key request
construction, JSON/SSE parsing, chunked Unicode, notifications, output limits,
protocol/tool/HTTP errors, rate limits, oversized stream cancellation and
pre-aborted requests. They make no network calls.

A separate live smoke test through the installed Pi extension loader retrieved
the original Transformer paper without credentials and verified that oversized
provider excerpts were capped at 16 KiB.
