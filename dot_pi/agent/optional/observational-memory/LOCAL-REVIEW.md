# Local observational-memory review — installed, opt-in

Source: https://github.com/amosblomqvist/pi-observational-memory
Pinned revision: `78a1efcfdd46332253fb289724f05b26dfc7769e`.

## Status

**Installed in normal Pi, off until `/om on`. No live model workers have run during setup.**
After offline testing, the user requested installation and chose the parent
session's model for both workers. The installed entry is
`agent/extensions/observational-memory/index.ts`; see its README for usage.
No global model/authentication settings were changed, no existing sessions were
migrated, and this conversation was not fed to memory workers. `learn` is pending.

The original 98 upstream tests and typecheck passed, but six additional readiness
regressions initially failed. Local repairs and the parent-model profile now pass **124 tests**, typechecking,
and factory loading through the installed Pi extension loader.

## Repairs

- Memory tools reject symlink traversal, including symlink-backed roots and hidden
  `.runs` IPC access. New files/directories are private. This is not an OS sandbox
  against another process racing filesystem changes.
- File reads/writes are limited to 64 KiB. Tool output is bounded to 16 KiB / 400
  lines; read supports offset/limit. Grep uses the installed `rg` with a 3-second
  deadline and explicit validated files instead of an unbounded JavaScript regex.
- Workers have bounded stderr, a five-minute default deadline, real SIGTERM →
  SIGKILL escalation, and listener/timer cleanup. An already-aborted launch does
  not start a process. Arbitrary SDK/test entrypoints are never treated as Pi.
- Transcript kickoff prompts are private @files rather than OS-visible argv text;
  Pi still records the expanded prompt in the worker session. Startup update and
  telemetry checks are disabled for workers; this does not disable model requests.
- Worker success requires an extension-written successful final-assistant status,
  not just a zero process exit. Observers must actually call their recording tool;
  an untouched empty result file is not accepted as successful coverage.
- Observer ledger entries carry orchestrator-owned chunk source IDs. Dispatch only
  advances over a contiguous covered/in-flight prefix; a failed early slice is
  retried rather than silently skipped behind a later success.
- Deterministic compaction requires complete source coverage before the cutoff.
  Missing coverage, an empty summary, or a summary exceeding 64 KiB falls back to
  Pi's normal compaction. Abort is respected while waiting for observers.
- Consolidators explicitly call `finish_consolidation` after writing topic files.
  The receipt names acknowledged observation IDs and hashes of durable topic files.
  Only acknowledged, still-active IDs are tombstoned after verification and a
  successful index write. Missing receipts, stale hashes, unknown IDs, and failed
  workers leave observations intact. This checks persistence, not factual quality.
- Disable, tree navigation and shutdown invalidate late results. Shutdown/disable
  wait for workers to exit. Invalid `/om` arguments no longer accidentally toggle
  memory on. The gate is restored from the active branch.

Original upstream README/comments describe the earlier protocol; where they
conflict with this file, this file describes the local implementation.

## Installed profile and remaining live validation

The installed entry supplies `src/parent-profile.ts`, overriding upstream/project
memory settings with the current parent model/thinking level, context-sized
budgets, one observer at a time, and debug logging off. It fails closed without a
selected model of at least 16k context. Upstream OpenRouter defaults are not used
by this entry. Global model settings are untouched. `pi-lean` remains unchanged.

Use a fresh normal Pi session and `/om on` to try it; `/om:status` shows the models
and clocks. A real worker/provider trial and meaningful recall evaluation remain
unverified. Start with nonsensitive synthetic facts, not an existing long audit.

Loading the vendor `src/index.ts` directly without the installed entry bypasses
this profile: it still uses the upstream custom config reader/defaults. That
standalone mode is not the supported local setup.

Durable topic files and JOURNEY are per-session but **not branch-rollbackable**;
`/tree` can therefore encounter durable facts written on another branch. Forks
seed durable memory. The current source uses a session-header ID to isolate roots.
LLM compression can still omit or distort facts despite persistence receipts.

Worker sessions, IPC and memory files persist until explicitly cleaned. Cost files
are best-effort recorded usage, not exact billing; results invalidated during
shutdown/navigation are not appended to a different/new session's ledger.

## Re-run offline checks

```bash
npm --prefix ~/.pi/agent/optional/observational-memory test
npm --prefix ~/.pi/agent/optional/observational-memory run typecheck
```

Development dependencies were installed with `npm ci --ignore-scripts`. All test
fixtures are synthetic and temporary; the cancellation test only kills its own
just-created fixture process. No credentials or live model calls are required.
