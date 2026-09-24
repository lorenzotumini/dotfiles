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
available. Wait for the scout to finish before disabling or reloading.

Try inside Herdr:

```text
/subagents:spawn trial-scout Map the source directories and test entry points. Do not modify anything.
```

The bare command toggles; `:status` reports state and `:spawn` starts a scout.

The proven trial limits remain: one read-only scout at a time, no nested spawning,
no copied parent history, parent-selected model by default, right-hand sibling
pane, automatic bounded result delivery. A tool allowlist is not an OS sandbox;
the scout can read files accessible to your account.

The former `pi-subagents` launcher and no-model live smoke script were removed.
No tmux or plain-terminal fallback is used by this integration.

Vendored implementation and offline regression tests:
`~/.pi/agent/optional/interactive-subagents/` (see `LOCAL-TRIAL.md`).
