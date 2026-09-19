/**
 * Browser extension — Playwright-driven headless Chromium pi can drive.
 *
 * Exposes a small set of tools the LLM can call to debug a live web app:
 *   - browser_goto         navigate
 *   - browser_eval         run JS in the page (read localStorage, decode JWTs,
 *                          inspect the DOM, etc.)
 *   - browser_console      drain buffered console + pageerror entries
 *   - browser_network      drain buffered network requests (status, headers)
 *   - browser_fill         fill an input
 *   - browser_click        click an element
 *   - browser_screenshot   write a PNG to /tmp and return the path
 *   - browser_close        close the persistent browser
 *
 * Plus a /browser command for quick status / close from the TUI.
 *
 * Browser state is a singleton kept alive across tool calls so login
 * sessions, cookies, and localStorage survive between turns. It's torn
 * down on `session_shutdown`.
 *
 * Setup:
 *   cd ~/.pi/agent/extensions/browser
 *   npm install
 *   node node_modules/playwright-core/cli.js install chromium
 *   # then /reload in pi (or restart)
 *
 * Tweaks:
 *   PI_BROWSER_HEADFUL=1   launch a visible window (useful when debugging
 *                          the extension itself).
 *   PI_BROWSER_PROFILE     override the user-data dir (default ~/.pi/agent/extensions/browser/.profile)
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { bounded, safeHeaders, safeUrl, toolResult } from "./safety.mjs";
import {
  chromium,
  type BrowserContext,
  type Page,
  type ConsoleMessage,
  type Request,
} from "playwright-core";

type ConsoleEntry = {
  ts: number;
  type: string;
  text: string;
  location?: string;
};

type NetEntry = {
  ts: number;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  failure?: string;
};

const MAX_BUF = 200;
const BROWSER_TOOL_NAMES = [
  "browser_goto",
  "browser_eval",
  "browser_console",
  "browser_network",
  "browser_fill",
  "browser_click",
  "browser_screenshot",
  "browser_close",
];
const ENABLED_ENTRY_TYPE = "browser-enabled";
const KEEP_HEADERS = new Set([
  "authorization",
  "apikey",
  "cookie",
  "set-cookie",
  "origin",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "content-type",
  "x-client-info",
  "accept-profile",
  "content-profile",
  "prefer",
  "location",
  "www-authenticate",
  "retry-after",
]);

function pushBounded<T>(buf: T[], entry: T): void {
  buf.push(entry);
  if (buf.length > MAX_BUF) buf.splice(0, buf.length - MAX_BUF);
}

function filterHeaders(
  h: Record<string, string>,
  allow: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (allow.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * Serialize all tool executions against the single shared Page.
 *
 * Playwright's Page is not concurrent-safe: if pi fires multiple browser_*
 * tools in one block (which it does by default for independent calls), two
 * `fill`s will race into the same field, and a `goto` followed by an `eval`
 * in the same batch will hit "Execution context was destroyed" because the
 * eval lands during the navigation teardown.
 *
 * Wrapping every execute body in this queue costs the latency we should be
 * paying anyway and removes the entire class of race from the LLM's mental
 * model.
 */
export default function browserExtension(pi: ExtensionAPI) {
  let opQueue: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = opQueue.then(fn, fn).catch((error) => {
      throw new Error(bounded(error instanceof Error ? error.message : String(error), 2048, 20).text);
    });
    opQueue = next.catch(() => {});
    return next;
  }
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const consoleBuf: ConsoleEntry[] = [];
  const netBuf: NetEntry[] = [];

  const profileDir =
    process.env.PI_BROWSER_PROFILE ??
    join(homedir(), ".pi", "agent", "extensions", "browser", ".profile");
  const headless = !process.env.PI_BROWSER_HEADFUL;

  async function ensurePage(): Promise<Page> {
    if (page && !page.isClosed()) return page;

    if (!context) {
      context = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: { width: 1280, height: 800 },
      });
    }

    page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    page.setDefaultTimeout(15_000);
    const observedPage = page;

    page.on("console", (msg: ConsoleMessage) => {
      if (page !== observedPage) return;
      const loc = msg.location();
      pushBounded(consoleBuf, {
        ts: Date.now(),
        type: msg.type(),
        text: bounded(msg.text(), 2048, 40).text,
        location: loc?.url ? `${safeUrl(loc.url)}:${loc.lineNumber}` : undefined,
      });
    });
    page.on("pageerror", (err) => {
      if (page !== observedPage) return;
      pushBounded(consoleBuf, {
        ts: Date.now(),
        type: "pageerror",
        text: bounded(`${err.name}: ${err.message}`, 2048, 40).text,
      });
    });
    page.on("requestfinished", async (req: Request) => {
      try {
        const res = await req.response();
        // Include security headers, then redact BEFORE retaining in buffers.
        const requestHeaders = safeHeaders(await req.allHeaders(), req.url());
        const responseHeaders = res ? safeHeaders(await res.allHeaders(), req.url()) : undefined;
        if (page !== observedPage || observedPage.isClosed()) return;
        pushBounded(netBuf, {
          ts: Date.now(),
          method: req.method(),
          url: safeUrl(req.url()),
          status: res?.status(),
          statusText: res ? bounded(res.statusText(), 128, 1).text : undefined,
          resourceType: req.resourceType(),
          requestHeaders,
          responseHeaders,
        });
      } catch {
        // request may have been aborted; ignore
      }
    });
    page.on("requestfailed", (req: Request) => {
      if (page !== observedPage) return;
      pushBounded(netBuf, {
        ts: Date.now(),
        method: req.method(),
        url: safeUrl(req.url()),
        resourceType: req.resourceType(),
        failure: bounded(req.failure()?.errorText ?? "request failed", 512, 4).text,
      });
    });

    return page;
  }

  async function teardown(): Promise<void> {
    const closing = context;
    context = null;
    page = null;
    try {
      await closing?.close();
    } catch {
      // best-effort
    }
    consoleBuf.length = 0;
    netBuf.length = 0;
  }

  // Default-off gate. The browser tools collectively cost ~800 system-prompt
  // tokens (snippets + guidelines), but are needed in a small minority of
  // sessions. We keep all 8 tools registered so they appear in
  // pi.getAllTools() and command discovery stays normal, but we strip them
  // from the active set so their promptSnippet / promptGuidelines drop out
  // of the system prompt. They become callable again when /browser on flips
  // them back into the active set.
  let enabled = false;

  function setEnabled(on: boolean): void {
    const active = new Set(pi.getActiveTools());
    if (on) {
      for (const name of BROWSER_TOOL_NAMES) active.add(name);
    } else {
      for (const name of BROWSER_TOOL_NAMES) active.delete(name);
    }
    pi.setActiveTools(Array.from(active));
    enabled = on;
  }

  async function enable(): Promise<void> {
    setEnabled(true);
    pi.appendEntry(ENABLED_ENTRY_TYPE, { on: true });
  }

  async function disable(): Promise<void> {
    setEnabled(false);
    await serialize(teardown);
    pi.appendEntry(ENABLED_ENTRY_TYPE, { on: false });
  }

  // Initialize the gate on session_start. We can't call setActiveTools
  // during the factory — the extension runtime isn't initialized yet and
  // pi throws "Action methods cannot be called during extension loading".
  // session_start fires after the runtime is up and after the registerTool
  // calls below have settled, so it's the first safe point to flip the
  // browser tools out of the active set.
  //
  // This handler also restores the per-session enable bit: the newest
  // browser-enabled custom entry wins. Survives /reload (the same session
  // replays its entries when the extension re-inits) but not /new (fresh
  // session has no entries, so we default to off).
  pi.on("session_start", async (_event, ctx) => {
    let want = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENABLED_ENTRY_TYPE) {
        const data = entry.data as { on?: boolean } | undefined;
        if (data && typeof data.on === "boolean") want = data.on;
      }
    }
    setEnabled(want);
  });

  pi.on("session_shutdown", async () => {
    await serialize(teardown);
  });

  pi.registerTool({
    name: "browser_goto",
    label: "Browser Goto",
    description:
      "Navigate persistent headless Chromium. Returns sanitized final URL and HTTP status. Cookies/localStorage persist. Tool arguments (including input URLs) are saved in sessions: avoid signed URLs or credentials in URL arguments.",
    promptSnippet:
      "Open a URL in a persistent headless browser to inspect a live web app's DOM, storage, network, and console — instead of asking the user to copy from devtools",
    promptGuidelines: [
      "When debugging a frontend issue (broken auth, failed requests, missing tokens, JS errors, form not working, blank screen), prefer driving the live app with browser_goto + browser_eval + browser_console + browser_network instead of asking the user to copy-paste from devtools.",
      "When the user reports 'works in browser, fails here' or 'I tried X and it didn't work', use browser_goto to reproduce the exact flow yourself before forming a hypothesis from source alone.",
      "After making a frontend change, use browser_goto plus browser_click / browser_fill to actually exercise the fix end-to-end before declaring it done — don't rely on the user to verify.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
      waitUntil: Type.Optional(
        StringEnum(["load", "domcontentloaded", "networkidle", "commit"] as const),
      ),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000 })),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        const resp = await p.goto(params.url, {
          waitUntil: params.waitUntil ?? "domcontentloaded",
          timeout: params.timeoutMs ?? 30_000,
        }).catch((error) => {
          // Preserve only a known Chromium error code, never raw URL/call logs.
          const code = error instanceof Error ? error.message.match(/net::[A-Z_]+/)?.[0] : undefined;
          const reason = code ?? (error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unknown cause");
          throw new Error(`Navigation failed: ${reason} (URL/call log omitted). Check the server, URL and timeout; inspect browser_network for sanitized diagnostics.`);
        });
        const status = resp?.status();
        const finalUrl = safeUrl(p.url());
        return toolResult(`${status ?? "?"} ${finalUrl}`, { status, finalUrl });
      });
    },
  });

  pi.registerTool({
    name: "browser_eval",
    label: "Browser Eval",
    description:
      "Evaluate JS in the current page: expression, function, async function or IIFE. Return JSON-serializable primitives/objects, not DOM nodes. Output capped at 16 KiB / 400 lines; no full object in saved details or temp files. Return small summaries, counts or assertions. Never return raw tokens, passwords, cookie values or full storage dumps; arbitrary eval output is NOT automatically secret-free. Evaluation failures are tool errors.",
    promptSnippet:
      "Inspect live DOM/state, credential presence or selected non-sensitive JWT claims; return small summaries rather than raw credentials or full storage dumps",
    promptGuidelines: [
      "Use browser_eval for runtime state and small assertions. Inspect credential presence/expiration without returning raw credentials, full JWT payloads or entire storage objects.",
    ],
    parameters: Type.Object({
      expression: Type.String({ description: "Expression or function source" }),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        // Playwright's evaluate(string) treats the string as an expression.
        // A user-written `() => foo` therefore evaluates to a function *value*
        // rather than calling it.
        //
        // Previous attempt: a regex that detected arrow/function shapes and
        // wrapped them in `(<src>)()`. That double-wrapped already-called
        // IIFEs like `(() => 42)()` into `((() => 42)())()` → `42()` → TypeError.
        //
        // Robust approach: ask the page itself. Evaluate the source once,
        // and if the result is a function, call it. This handles all three
        // forms (plain expr, function value, IIFE) without ambiguity.
        const src = params.expression;
        const wrapped = `(() => { const __v = (${src}); return typeof __v === 'function' ? __v() : __v; })()`;
        try {
          const result = await p.evaluate(wrapped);
          const text =
            typeof result === "string"
              ? result
              : (JSON.stringify(result, null, 2) ?? String(result));
          return toolResult(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Pi marks tool errors only when execute throws.
          throw new Error(`eval error: ${bounded(msg, 1900, 18).text}`);
        }
      });
    },
  });

  pi.registerTool({
    name: "browser_console",
    label: "Browser Console",
    description:
      "Read the latest console/pageerror entries in chronological order (max 200 retained, each text capped at 2 KiB / 40 lines). Output capped at 16 KiB / 400 lines; no hidden full copy is saved. clear=true (default) wipes the ENTIRE buffer, including filtered/omitted entries; use clear=false to inspect then narrow the filter. Arbitrary console text can contain secrets: avoid logging them in the app.",
    promptSnippet:
      "Read JS errors and console output captured since last drain — reach for this whenever a page seems broken without an obvious network cause",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_BUF, description: "Latest entries (default 100, max 200)" })),
      filter: Type.Optional(
        Type.String({ description: "Only entries whose text/location contains this substring" }),
      ),
      clear: Type.Optional(
        Type.Boolean({
          description:
            "Clear the entire buffer after read (not just returned entries). Default true.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const limit = params.limit ?? 100;
        const filter = params.filter;
        const filtered = filter
          ? consoleBuf.filter(
              (e) => e.text.includes(filter) || (e.location ?? "").includes(filter),
            )
          : consoleBuf.slice();
        const out = filtered.slice(-limit);
        if (params.clear ?? true) consoleBuf.length = 0;
        const text =
          out
            .map(
              (e) =>
                `[${new Date(e.ts).toISOString()}] ${e.type}: ${e.text}${e.location ? `  @ ${e.location}` : ""}`,
            )
            .join("\n") || "(empty)";
        return toolResult(text, { matched: filtered.length, selected: out.length, cleared: params.clear ?? true });
      });
    },
  });

  pi.registerTool({
    name: "browser_network",
    label: "Browser Network",
    promptSnippet:
      "Inspect HTTP status, method, sanitized URL and headers. Known sensitive header values are always redacted; auth headers reveal presence only.",
    promptGuidelines: [
      "Use browser_network with verbose=true and urlFilter for auth/CORS debugging. Authorization, cookies, API keys and tokens show presence only, never values. Do not try to bypass redaction with browser_eval.",
    ],
    description:
      "Read the latest buffered requests in chronological order (max 200 retained). Defaults to terse status/method/sanitized URL. verbose=true includes curated headers; includeHeaders adds others, but known sensitive values ALWAYS stay redacted, including in saved details. No raw headers are retained in buffers. URL credentials, known sensitive query parameters and fragments are redacted. Output capped at 16 KiB / 400 lines; omitted data is not saved. clear=true (default) wipes the ENTIRE buffer, including filtered/omitted entries; use clear=false to inspect then narrow the filter. Bodies are not captured. Consume fetch response bodies to avoid misleading ERR_ABORTED observations.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_BUF })),
      urlFilter: Type.Optional(Type.String({ description: "Substring filter on URL" })),
      status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599, description: "Exact HTTP status to match" })),
      verbose: Type.Optional(
        Type.Boolean({
          description:
            "Inline a curated set of request/response headers on each row. Off by default to keep context small.",
        }),
      ),
      includeHeaders: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Extra header names (case-insensitive). Implies verbose=true. Sensitive values remain redacted; no override.",
          maxItems: 32,
        }),
      ),
      clear: Type.Optional(
        Type.Boolean({
          description:
            "Clear the entire buffer after read (not just returned entries). Default true.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        let entries = netBuf.slice();
        if (params.urlFilter) {
          const needle = params.urlFilter;
          entries = entries.filter((e) => e.url.includes(needle));
        }
        if (params.status != null) {
          const wanted = params.status;
          entries = entries.filter((e) => e.status === wanted);
        }
        const out = entries.slice(-(params.limit ?? 100));
        if (params.clear ?? true) netBuf.length = 0;

        const extra = (params.includeHeaders ?? []).map((h: string) => h.toLowerCase());
        const showHeaders = params.verbose === true || extra.length > 0;
        const allow = new Set([...KEEP_HEADERS, ...extra]);

        const lines: string[] = [];
        for (const e of out) {
          lines.push(
            `${e.status ?? "ERR"} ${e.method} ${e.url}${e.failure ? `  (${e.failure})` : ""}`,
          );
          if (showHeaders) {
            const reqH = e.requestHeaders ? filterHeaders(e.requestHeaders, allow) : {};
            for (const [k, v] of Object.entries(reqH)) lines.push(`  → ${k}: ${v}`);
            const resH = e.responseHeaders ? filterHeaders(e.responseHeaders, allow) : {};
            for (const [k, v] of Object.entries(resH)) lines.push(`  ← ${k}: ${v}`);
          }
        }
        const text = lines.join("\n") || "(empty)";
        return toolResult(text, { matched: entries.length, selected: out.length, cleared: params.clear ?? true });
      });
    },
  });

  pi.registerTool({
    name: "browser_fill",
    label: "Browser Fill",
    description: "Fill the matching input. Values are not echoed in results, but tool arguments are saved in sessions. Prefer user-managed authentication; do not request passwords through chat.",
    promptSnippet:
      "Type into an input on the live page (dispatches input / change events properly, unlike a raw .value= assignment)",
    parameters: Type.Object({
      selector: Type.String(),
      value: Type.String(),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        try {
          await p.fill(params.selector, params.value);
        } catch {
          // Playwright call logs may include the input value. Never echo them.
          throw new Error("Unable to fill input (value omitted). Check the selector and whether the input is editable.");
        }
        return toolResult(`filled ${params.selector}`);
      });
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click the element matching the selector. CSS selectors and Playwright text= / role= selectors supported. Note: CSS attribute selectors match HTML attributes, not DOM properties — e.g. `button[type=submit]` will NOT match `<button>Submit</button>` even though that button's DOM `.type === 'submit'` by default. For semantic matching prefer `text=Submit` or `role=button[name=Submit]`.",
    promptSnippet:
      "Click an element on the live page — drives the app the way a user would, including form submits and SPA navigations",
    parameters: Type.Object({
      selector: Type.String(),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        await p.click(params.selector);
        return toolResult(`clicked ${params.selector}`);
      });
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Save a PNG screenshot to a temp file and return its path. Use the read tool on that path to view it (separate step so vision-token cost is paid only when you choose).",
    promptSnippet:
      "Capture a PNG of the current page when DOM / state inspection isn't enough and you need to see the visual",
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        const dir = mkdtempSync(join(tmpdir(), "pi-browser-"));
        const file = join(dir, "screenshot.png");
        await p.screenshot({ path: file, fullPage: params.fullPage ?? false, type: "png" });
        return {
          content: [{ type: "text", text: file }],
          details: { path: file },
        };
      });
    },
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser Close",
    description: "Close the persistent browser context. Next browser_* call relaunches.",
    promptSnippet:
      "Tear down the headless browser (rarely needed; auto-cleans on session end)",
    parameters: Type.Object({}),
    async execute() {
      return serialize(async () => {
        await teardown();
        return toolResult("browser closed");
      });
    },
  });

  pi.registerCommand("browser", {
    description:
      "Browser tools: bare '/browser' toggles, '/browser on' to enable, '/browser off' to disable + close, '/browser status' for status",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim().toLowerCase();
      if (cmd === "status") {
        const toolState = enabled ? "enabled" : "disabled (run /browser on)";
        const procState =
          page && !page.isClosed() ? `, open at ${safeUrl(page.url())}` : "";
        ctx.ui.notify(`browser tools: ${toolState}${procState}`, "info");
        return;
      }
      const action =
        cmd === "" ? (enabled ? "off" : "on")
        : ["on", "enable"].includes(cmd)
          ? "on"
          : ["off", "disable", "close", "kill"].includes(cmd)
            ? "off"
            : null;
      if (action === null) {
        ctx.ui.notify("Usage: /browser [on|off|status]", "warning");
        return;
      }
      if (action === "on") {
        if (enabled) {
          ctx.ui.notify("browser tools already enabled", "info");
          return;
        }
        await enable();
        ctx.ui.notify("browser tools enabled", "info");
        return;
      }
      const wasRunning = !!(page && !page.isClosed());
      await disable();
      ctx.ui.notify(
        wasRunning ? "browser tools disabled, browser closed" : "browser tools disabled",
        "info",
      );
    },
  });

  // Default-off gate: tools stay registered (visible in pi.getAllTools(),
  // command discovery normal) but their promptSnippet / promptGuidelines
  // drop out of the system prompt and they're not callable until
  // /browser on adds them back. The actual setActiveTools call happens in
  // the session_start handler above, because pi forbids action methods
  // during the factory.
}
