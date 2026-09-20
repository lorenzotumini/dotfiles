# web-fetch

`web_fetch({url})` reads HTTP(S) HTML, PDF or text. Extraction runs locally;
requests still reach the site and its redirects. No debug cookies are attached.

- `mode: "readable"` (default): Readability plus a local DOM/RSC fallback;
  relative links use the final URL or HTML base. Tables/code are preserved;
  complex tables keep HTML. Suspected challenge/login pages report errors.
  Useful short documents succeed without a length-based warning.
- `mode: "raw"`: original decoded text/HTML for inspecting extraction omissions.
- `mode: "render"`: fresh unauthenticated local Chromium, independent of the
  interactive debug profile. Scripts/XHR execute; images/media/fonts are blocked.
  A bounded one-second settling window covers common SPAs, not every delayed app.
  Requires the sibling browser extension's installed Playwright/Chromium.
- `pages: "7-10,15"`: physical PDF page selection; first 20 by default, maximum
  100 per call. Originals are retained locally for the PDF skill. Returned text
  includes physical indices, PDF labels when present, and empty-text warnings.
  `sourceTruncated` reports unextracted pages separately from output truncation.

HTML/PDF parsing runs in a disposable worker (15-second deadline, 256 MiB JS
heap ceiling). Cancellation terminates the worker, including CPU-bound work.
PDF extraction is basic text: use the local PDF skill and page images to check
multi-column order, equations, tables and scans.

`allowJina: true` permits external Jina Reader fallback after local failure.
It is off by default and sends the full URL externally. The tool instructions
require explicit user authorization for a public, non-sensitive URL. Successful
local extraction, oversized responses, unsupported types and PDF parser errors
never trigger Jina. Rendering remains local even when interactive tools are off.

## Limits and artifacts

Output is capped at **24 KiB / 600 lines**; full extracted output is saved when
truncated. Errors are capped at 2 KiB / 20 lines. Headers report final and, when
different, requested URLs. Download limits are **5 MiB**, or **20 MiB** for PDFs,
including magic-byte detection through generic download endpoints. Actual
streamed bytes are counted. The total request/fallback deadline is 30 seconds.

Original PDFs and truncated search/fetch results share a private OS-temp folder
`pi-web-artifacts-<uid>` (0700; files 0600). On writes, entries older than 24 hours
are pruned, then oldest entries are removed to fit 128 files / 128 MiB. Limits
are best-effort across concurrent Pi processes; no daemon removes idle files.
Save a copy elsewhere for durable work. Full extracted text is not a claim of
complete source coverage. Use `read` offset/limit or search saved files.

## Maintenance

Run `npm ci --ignore-scripts` in this extension's installed directory; existing
lockfile dependencies are unchanged. Source and sibling `web-shared` helpers
must be installed together. Restart Pi or `/reload` after applying changes.

`npm test` uses the Pi loader, synthetic HTTP responses and generated PDFs.
Set `PI_CODING_AGENT_PACKAGE` if Pi is not found beside Node/npm. Browser rendering
and cancellation are tested by the sibling browser suite against a local server.
