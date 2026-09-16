# Pi user configuration

This directory is managed by chezmoi. Credentials and machine/session state are
intentionally not tracked: `auth.json`, `models-store.json`, `trust.json`, and
`sessions/` remain local.

## Dependencies

Chezmoi tracks source and lockfiles, not generated dependencies:

```bash
cd ~/.pi/agent/extensions/bash-guard && npm ci --ignore-scripts
cd ~/.pi/agent/extensions/browser && npm ci --ignore-scripts
cd ~/.pi/agent/extensions/web-fetch && npm ci --ignore-scripts
cd ~/.pi/agent/extensions/web-search && npm ci --ignore-scripts
cd ~/.pi/agent/optional/interactive-subagents && npm ci --ignore-scripts
cd ~/.pi/agent/optional/observational-memory && npm ci --ignore-scripts
```

For PDF and YouTube helpers, install their dependencies into local environments
rather than this config tree. Chezmoi ignores `.venv/`, Python caches and
`node_modules/`.

The optional Herdr subagent integration is Linux/Herdr-only and is omitted by
chezmoi on Windows. Normal Pi enables it inside Herdr; `pi-lean` loads it but
keeps it off until `/subagents on`. Observational memory is normal-Pi-only and
remains off until `/om on`.

After applying or changing extensions, restart Pi or use `/reload` as appropriate.
