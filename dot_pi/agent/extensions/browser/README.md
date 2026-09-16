# Browser extension

Eight Playwright tools for live frontend inspection with persistent Chromium.
Tools are **registered but off by default**, to avoid adding browser tool schemas
and instructions to every session.

## Install / enable

```bash
cd ~/.pi/agent/extensions/browser
npm ci --ignore-scripts
node node_modules/playwright-core/cli.js install chromium
```

Use the local CLI after installing/updating Playwright: `npx playwright` may
fetch a different version and download incompatible Chromium revisions.

In Pi:

```
/reload
/browser on       # enable all eight tools
/browser          # status
/browser off      # disable + close Chromium, clear buffers
```

`on`/`enable` and `off`/`disable`/`close`/`kill` are accepted. The enable bit is
saved as a custom session entry and restored from the **active branch** on
reload/resume. A new session starts off. Enabling does not launch Chromium;
the first page-touching tool does. Unrelated tools stay enabled/disabled as they
were; the extension changes only its own eight tools.

## Tools

| Tool | Purpose |
|---|---|
| `browser_goto` | Navigate; return HTTP status and sanitized final URL |
| `browser_eval` | Evaluate expression, function, async function or IIFE; return a small serializable summary |
| `browser_console` | Inspect latest console/pageerror entries |
| `browser_network` | Inspect latest requests, status and optional sanitized headers |
| `browser_fill` | Fill an input; input value not echoed in output/errors |
| `browser_click` | Click using CSS or Playwright text/role selectors |
| `browser_screenshot` | Save a PNG to a private temp directory; use `read` to view |
| `browser_close` | Close context and clear buffers; tools stay enabled and next navigation relaunches |

`browser_eval` failures **throw** so Pi reports real tool errors. A returned
`isError` property alone would not do this. Oversized errors are capped.
For DOM elements return selected primitive properties, not the elements.
Selectors such as `role=button[name=Submit]` match semantic defaults more reliably
than `button[type=submit]` when the HTML omits a `type` attribute.

## Privacy: always-redacted network headers

Known sensitive names (case-insensitive, punctuation-normalized) are redacted
**before insertion into the extension buffers**, including Authorization,
Proxy-Authorization, cookies/Set-Cookie, API keys, tokens, passwords, secrets,
credentials, signatures, CSRF/XSRF and session identifiers. The value becomes
`[redacted]`: header presence is observable, the value is not.

`verbose: true` displays curated headers. `includeHeaders` adds header names,
**never an override to redaction**. The extension uses Playwright `allHeaders()`
to include cookie/security headers that `headers()` may omit, then sanitizes.
URL credentials, known sensitive query parameters and fragments are redacted,
including URL-valued Location/Referer headers. Navigation errors omit raw call
logs, which otherwise echo input URLs.

`details` contains only counts, status, sanitized URL, screenshot path or a
truncation flag—not raw headers, full log entries or eval result objects.

### Important limits to privacy guarantees

- This is name-based redaction, not a universal secret detector. Unknown custom
  headers, URL paths, ordinary query fields and embedded URLs can contain secrets.
- **Arbitrary eval results, console text, screenshots and page error messages can
  still contain secrets.** Do not dump localStorage, cookie values, full JWTs,
  auth bodies or password fields. Return booleans/counts, expiry and selected
  non-sensitive claims instead. Never use eval to bypass network redaction.
- **Tool arguments are saved in session logs** by Pi. Hiding fill values in tool
  results does not remove them from tool calls. Prefer user-managed login or an
  already-authenticated profile, rather than supplying passwords/tokens in chat.
- Persistent browser profiles contain real cookies/storage. Protect them as
  credentials. Redaction does not change the browser's actual outgoing requests.
- Old session logs are not scrubbed by this update.

## Output and buffer limits

- Text outputs: **16 KiB / 400 lines**, including the truncation notice.
- Errors: **2 KiB / 20 lines**.
- Console and network buffers: at most **200 entries each** (oldest evicted).
- Console text: **2 KiB / 40 lines per entry**; URLs capped at 1 KiB.
- Captured header maps: at most **64 names**, each name capped at 128 bytes and
  non-sensitive value capped at 256 bytes / 2 lines.
- `limit`: integer 1–200 (default 100). Returns the latest matching entries in
  chronological order.
- Omitted text is **not saved to disk or hidden in metadata**. There is no raw
  full-output dump to accidentally refill context or store secrets.

`clear: true` (default) wipes the **entire** relevant buffer after reading,
including entries excluded by filters, limits or truncation. Start with
`clear: false` when exploring, then narrow `filter` / `urlFilter` / `status`.
The metadata's `selected` count is the number selected before output truncation,
not a claim that all selected rows fit in the returned text.

## Lifecycle and known limitations

- Tools serialize against the shared page in submission order; close/off/shutdown
  also use the same queue. A failed operation does not poison the queue.
- Closing clears buffers and prevents stale asynchronous network callbacks from
  repopulating them. The persistent profile remains on disk.
- `browser_goto` defaults to 30 seconds (configurable up to 120 seconds); ordinary
  Playwright actions default to 15 seconds.
- Arbitrary eval is not a sandbox, and has no execution deadline. A never-resolving
  promise or infinite loop can stall operations, including queued shutdown.
  Avoid unbounded evaluations; active-operation cancellation is not implemented.
- One shared page; no tab management, file-upload/download or OTP helpers.
- Network headers/status only: request/response bodies are not captured. Consume
  response bodies in eval (`await r.text()`) to avoid misleading ERR_ABORTED rows.
- Asynchronous request-finished header capture may complete just after a drain;
  repeat a narrow peek if a just-finished request has not appeared yet.
- Two Pi processes cannot safely open the same persistent profile concurrently.
  Use separate `PI_BROWSER_PROFILE` paths when needed.

## Environment

| Variable | Behavior |
|---|---|
| `PI_BROWSER_PROFILE` | Override persistent profile; default `~/.pi/agent/extensions/browser/.profile` |
| `PI_BROWSER_HEADFUL` | Any nonempty value launches a visible window instead of headless |

## Tests

```bash
npm --prefix ~/.pi/agent/extensions/browser test
```

Tests load the actual extension through installed Pi and drive all eight tools
against a local HTTP fixture with synthetic credentials and a temporary profile.
They verify redaction in text/serialized details, output/error limits, network
and console filters/draining, page errors, filling/clicking, screenshots,
persistence, activation/branch restoration and serialization. No real accounts
or the default profile are used. Temporary profiles/screenshots are cleaned up.
Set `PI_CODING_AGENT_PACKAGE` for a Pi installation outside the usual Node/npm
locations. Chromium must already be installed via the matching local CLI.
