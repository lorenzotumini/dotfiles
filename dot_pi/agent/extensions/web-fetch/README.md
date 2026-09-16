# web-fetch

Fetch HTTP(S) pages as markdown using Readability/Turndown, with plain-text,
PDF and Next.js RSC extraction paths. **External Jina Reader fallback is OFF
by default.** Missing or false `allowJina` means failed/incomplete extraction
never forwards the URL to Jina. Useful short extracts are returned with an
incomplete-extraction warning; otherwise the tool reports the local failure.

`allowJina: true` explicitly permits fallback for that call only, after local
extraction fails/is incomplete. It sends the full requested URL to Jina. The
agent is instructed to obtain explicit user authorization, and not to enable
this for private, confidential or signed URLs. Success locally never contacts
Jina, even with opt-in. Oversize/unsupported responses also never use fallback.

The default still contacts the requested website and follows its redirects;
“local extraction” means parsing on your machine, not offline/no networking.

## Context protection

- Returned text, including headings and truncation notice: **24 KiB / 600 lines**,
  whichever limit is reached first. These are byte/line limits, not token counts.
- All extraction paths share the same final output limiter, including Jina/PDF.
- If truncated, the full extracted text is saved to a unique private directory
  under the OS temp directory (`pi-web-fetch-*/content.md`, file mode `0600`).
- The tool returns that path and small metadata only; full content is not hidden
  in result details. Read selected sections with `read` offset/limit or search
  the saved file. Reading it all again defeats context protection.
- UTF-8 is preserved even when truncation falls inside a long line.
- Error text is limited to 2 KiB / 20 lines; titles and URL metadata are bounded.
- Saved files remain available after the call; clean them up when no longer
  needed. They contain fetched content and are not automatically expired here.

## Download protection

HTTP and Jina responses are streamed with a **5 MiB** body limit; PDFs use
**20 MiB**. Actual bytes are counted, so missing/incorrect Content-Length and
compressed/chunked responses cannot bypass the limit. Oversized bodies are
cancelled, not retried through Jina. Each request has a 30-second timeout and
honors caller cancellation. A fallback can take an additional 30 seconds.

PDF extraction still reads at most the first 100 pages, as reported in the
saved text. “Full extracted text” means the extraction result, not original HTML
or guaranteed complete source-document content. PDF resources are destroyed
after extraction.

## Installation and tests

```bash
cd ~/.pi/agent/extensions/web-fetch
npm ci --ignore-scripts
npm test
```

Tests use the installed Pi extension loader with mocked HTTP responses. They
exercise size and line limits, long single lines, Unicode, large titles, small
metadata, full-text preservation, HTML, Jina fallback, PDF extraction, oversized
body cancellation, invalid protocols, cancellation and bounded errors.

Set `PI_CODING_AGENT_PACKAGE` to Pi's package directory if it is not found beside
Node or under npm's global root. Use `/reload` in Pi to activate changes.

Existing oversized results already recorded in a session are not rewritten.
Use `/compact` or start a fresh session if an earlier fetch filled the context.
