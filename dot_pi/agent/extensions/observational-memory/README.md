# Observational memory — installed, opt-in

Normal Pi discovers this extension. It adds no model tools or memory processing
until you explicitly enable it for a session. `pi-lean` does not load it.

Start a fresh normal Pi session, then:

```text
/om
/om:status
```

Optional manual actions: `/om:compact` and `/om:consolidate`. Normally the clocks
handle these automatically; do not repeatedly force them to check progress.

## Installed profile

Both background workers use the parent session's selected provider/model and
thinking level. Future workers follow model changes; already-running workers
finish with their original model. No global model settings are changed.

The installed profile overrides upstream/project memory configuration to prevent
an unexpected provider switch. It uses context-sized budgets: up to 2k raw tokens
per observer chunk, a 2k observation-pool target, consolidation at up to 4k pool
tokens, a context trigger at 60% of the model window (capped at 64k), and one
observer at a time. A consolidator may run alongside the observer. Workers have
a five-minute deadline. Models below a 16k context window are refused.

`/om:status` displays the worker models, thinking levels, clocks, worker states,
recorded cost, and last error. The on/off gate survives resume on the active branch.
`PI_OM_PASSIVE=1` still suppresses triggers for debugging.

## Before trying it

- **Use a fresh session.** Enabling midway through a long conversation can send
  earlier conversation chunks to workers and consume substantial tokens/quota.
- Workers make additional model calls. Using the same provider/model is not free.
- Memory and IPC live under `<project>/.memory/<session-id>/`; worker sessions are
  also recorded. Avoid sensitive material and exclude `.memory/` from version
  control before enabling in a repository. No project ignore files are changed
  automatically.
- `/om` toggles the gate; turning it off stops workers but does not delete memory
  or undo past compactions.
- Durable topic files/JOURNEY do **not** roll back under `/tree`.
- LLM compression can still omit or distort facts. Missing coverage/receipts fail
  conservatively, but this is not a guarantee of perfect memory.

Implementation/review notes: `~/.pi/agent/optional/observational-memory/LOCAL-REVIEW.md`.
At installation: 124 offline tests, typechecking, and installed-Pi loader checks
pass. Real model/provider behavior still needs the user's trial.
