# Local Herdr integration (promoted from trial)

Based on https://github.com/amosblomqvist/pi-interactive-subagents at
`c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7`. The original README describes upstream;
this file describes the local adaptation. Preserve/review local changes before
updating the vendor checkout.

## Usage

Normal `pi` discovers `agent/extensions/interactive-subagents/index.ts`, which
loads this implementation. The three subagent tools are active by default inside
Herdr (CLI or app) and hidden outside it. If the extension is loaded in
`pi-lean`, its tools start off:

```text
/subagents        # toggle
/subagents:status
```

Manual gate choices survive reload/resume on the active branch, separately for
main and lean profiles. CLI tool exclusions still apply. Off removes the schemas
and associated tool instructions, not past results already in conversation history.

Choose the parent model using `/model`, then try:

```text
/subagents:spawn scout Map the main source directories and test entry points. Return a short report without modifying anything or inspecting credentials.
```

`/subagents:spawn` asks the parent to call the tool. The scout opens on the right with a
vertical divider and no requested focus change. The final report returns
asynchronously, and its pane stays open for follow-ups. Type in the child pane
or ask the parent to follow up by its display name via `subagent_message`.
Close the child with Ctrl+D in its Pi prompt. A closed child can be resumed by
name with its saved model and tools. Set `PI_SUBAGENT_KEEP_OPEN=0` before
starting the parent Pi to use the profile's auto-exit behavior.

The standalone `pi-subagents` launcher and live-check script were removed after
the user confirmed live Herdr operation. The automated regression tests remain.

## Herdr app (herdr-core) backend

Subagents also work inside the **Herdr desktop app**, which runs its terminals
in `herdr-core` (`hc`) rather than the `herdr` CLI. The app sets `HC_TERMINAL_ID`
+ `HC_TERMINAL_SOCKET` (not the CLI's `HERDR_*` vars). `surface.ts` auto-selects
the backend from the environment:

- `HERDR_ENV=1` (+ `HERDR_PANE_ID`/`HERDR_SOCKET_PATH`) → `herdr.mjs` (CLI)
- `HC_TERMINAL_ID` + `HC_TERMINAL_SOCKET` → `herdr-core.mjs` (app)
- otherwise → `tmux.ts`

`PI_SUBAGENT_MUX` can override: `herdr`, `hc`/`herdr-core`, or `tmux`. The
gate in the integration entry recognizes both environments; an explicit mux
must match the detected one.

The app backend starts a Bash terminal in the caller's core and requests a
right split via `herdr-app do terminal.keep`. It retries while the app discovers
the child. The child can still run if the desktop window is unavailable. It reports completion through the same
`.exit` and `.done` files as the CLI backend. The watcher checks the core for
unexpected terminal exits, and cleanup disables shell recovery before stopping
and removing the child terminal.

## Subagent models

The bundled profiles inherit the parent's hosted model by default. Model
selection uses the tool's explicit model, the profile's model, the optional
`PI_SUBAGENT_MODEL` environment variable, then the current parent model, in that
order. To choose a hosted model for one launch:

```text
/subagents:spawn scout --model provider/model List the top-level directories.
```

When the parent uses a local model, Herdr requires a registered, provider-qualified
hosted model for the child. Known local providers and loopback endpoints are
blocked for Herdr subagents, including on resume. Resume uses the saved model
from the original launch.

## Scope, context, and safety

- The bundled `scout` has `read`, `grep`, `find`, `ls`, and parent
  communication via `ask_question`. Researcher and worker have separate tool lists.
- New sessions use the context and tools defined by their selected profile.
- Completion reports are capped at 16 KiB / 400 lines. Full output stays in the child
  session; artifacts and snapshots remain for inspection/resume.
- New handoff directories/files use explicit private permissions, without relying
  on a dedicated launcher's umask or changing the parent process's global umask.
- Completion comes from a private shell-written exit-status file, never an arbitrary
  sentinel in model-controlled terminal output.
- CLI calls are bounded and explicitly targeted. Only child panes created by this
  backend may be controlled. No focused-session fallback.

This is a tool allowlist, **not an OS security sandbox**. Files readable by your
account may be accessible outside the project. Avoid sensitive tasks and files.

## Lifecycle limitations

- Outside Herdr, normal Pi/lean still start and work; only subagents are unavailable.
- The original tmux backend remains as upstream source, but the integrated gate
  requires Herdr and refuses an explicit conflicting backend selection.
- Wait for the scout before `/reload`, `/new`, or quitting. Orderly shutdown/reload
  cancels watchers and closes their children; it is not a detach operation.
- Hard crashes may leave panes/processes behind. Inspect before resuming a child;
  automatic crash reattachment is not implemented.
- Escape/abort leaves the child available for inspection rather than reporting
  success. `ask_question` parks it until its parent replies.
- Slow shell startup can require `PI_SUBAGENT_SHELL_READY_DELAY_MS=2500` or higher.
- Switching profiles on an existing session does not remove its past messages.

## Offline tests

```bash
npm --prefix ~/.pi/agent/optional/interactive-subagents run test:local
```

Uses the installed Pi runtime (override `PI_CODING_AGENT_PACKAGE` if necessary),
no dependency installation required. Includes upstream units, backend tests,
simulated lifecycle checks with real generated bash scripts but fake Herdr/Pi,
and integration-gate checks. These tests make no live pane or model calls and use
only synthetic temporary sessions.
