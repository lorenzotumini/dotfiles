# Local Herdr integration (promoted from trial)

Based on https://github.com/amosblomqvist/pi-interactive-subagents at
`c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7`. The original README describes upstream;
this file describes the local adaptation. Preserve/review local changes before
updating the vendor checkout.

## Usage

Normal `pi` discovers `agent/extensions/interactive-subagents/index.ts`, which
loads this implementation. The three subagent tools are active by default inside
Herdr and hidden outside it. `pi-lean` loads the same entry, but starts them off:

```text
/subagents        # toggle
/subagents:status
```

Manual gate choices survive reload/resume on the active branch, separately for
main and lean profiles. CLI tool exclusions still apply. Off removes the schemas
and associated tool instructions, not past results already in conversation history.

Choose the parent model using `/model`, then try:

```text
/subagents:spawn trial-scout Map the main source directories and test entry points. Return a short report without modifying anything or inspecting credentials.
```

`/subagents:spawn` asks the parent to call the tool. The scout opens on the right with a
vertical divider and no requested focus change. The final report returns
asynchronously; its pane closes on completion. Ask the parent to follow up by the
scout's display name using `subagent_message`. A finished child is resumed by name
with its saved model/tool loadout. No polling by the model is needed.

The standalone `pi-subagents` launcher and live-check script were removed after
the user confirmed live Herdr operation. The automated regression tests remain.

## Scope, context, and safety

- One running read-only `trial-scout` per parent, including in-flight launches.
- Uses the fixed bundled profile rather than project/global overrides.
- Child tools: `read`, `grep`, `find`, `ls`, and parent communication `ask_question`.
- No shell/mutation tools, nested delegation, or child skill discovery.
- Fresh context with a lineage link; no copied parent conversation.
- Defaults to the parent's selected model; explicit tool-call overrides are possible.
  Both parent and child work consume tokens. No new provider is configured.
- The existing Herdr reporting hook is explicitly loaded into the child if present;
  its source is unchanged. Parent safety hooks remain as configured.
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
