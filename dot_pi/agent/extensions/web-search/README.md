# Web search — free, keyless Exa

`web_search` uses `https://mcp.exa.ai/mcp` without keys/accounts, retries, paid
fallbacks, model identity or session transcripts. Only queries/options reach Exa.
Exa's free service is rate limited and does not establish a no-retention or
no-training guarantee. A 429 is reported to the agent without retrying.

Ordinary calls use `web_search_exa`. `query`, `count` (1–10; default 5), and
legacy `exactPhrases`, `excludeTerms`, `site` remain supported. The legacy fields
compose query hints; they do not promise Google's operator semantics.

Optional `includeDomains`, `excludeDomains` (domain names),
`startPublishedDate`, `endPublishedDate` (YYYY-MM-DD), and `maxAgeHours` select
keyless `web_search_advanced_exa` through the endpoint's explicit tools parameter.
Date inputs and domain syntax are validated. Freshness refers to cached content
age, not publication age; 0 requests a fresh crawl. Structured results receive
numbered titles/URLs/dates/excerpts. Domain/date mismatches are flagged when
provider metadata allows checking; unknown provider text is preserved as-is.
Returned dates and excerpts still need source verification.

## Bounds and retention

- 16 KiB / 400 lines of output; 1 MiB streamed response; 2 KiB / 20-line errors.
- 25-second deadline including streamed reading; caller cancellation supported.
- JSON and SSE responses are supported; matching response closes the stream.
- Truncated full output is saved privately through sibling `web-shared`, shared
  with fetch: 128 files / 128 MiB, old entries pruned after 24 hours on later writes.
  Read selected ranges instead of putting the whole artifact back into context.
- Small metadata only; no hidden full response in session result details.

Use `web_fetch` for sources, `mode=render` for JS pages, and `browser_enable`
when interaction is needed. `EXA_API_KEY` is ignored; the legacy Google auth
example is not part of setup. Backend-specific transport/formatting remains in
`exa.mjs`; Pi registration lives in `index.ts`.

Run `npm test` for offline JSON/SSE, limits, request/filter and formatting checks.
No npm dependencies were added. Install the sibling shared helper and `/reload`.

References: [Exa MCP](https://exa.ai/docs/get-started/exa-mcp),
[advanced tool source](https://github.com/exa-labs/exa-mcp-server/blob/main/src/tools/webSearchAdvanced.ts),
[privacy policy](https://exa.ai/privacy-policy).
