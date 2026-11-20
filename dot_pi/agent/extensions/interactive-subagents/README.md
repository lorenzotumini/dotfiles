# Herdr subagents

Loaded automatically by normal Pi. Inside Herdr, the three subagent tools are
active by default. Outside Herdr they stay hidden and cannot create panes.

`pi-lean` explicitly loads this extension but defaults its tools off. Use:

```text
/subagents        # toggle
/subagents:status
```

The gate persists on the active session branch, separately for main and lean
profiles. Off removes tool schemas and their prompt instructions; commands remain
available. Close open subagent panes before disabling or reloading.

Try inside Herdr:

```text
/subagents:spawn scout Map the source directories and test entry points. Do not modify anything.
```

The bare command toggles; `:status` reports state and `:spawn` starts a scout.

The bundled `scout` is read-only and reports back when it finishes. Its pane
stays open for follow-ups until you exit the child Pi.
The `researcher` and `worker` profiles have their own tool lists.

The former `pi-subagents` launcher and no-model live smoke script were removed.
No tmux or plain-terminal fallback is used by this integration.

Vendored implementation and offline regression tests:
`~/.pi/agent/optional/interactive-subagents/` (see `LOCAL-TRIAL.md`).
