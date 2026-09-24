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

## Learning tools

The teaching guide and `quiz` extension support learning sessions. Use `/learn`
to toggle learning mode and quiz access; `/learn:status` reports the current
mode. The guide is kept outside Pi's skills directory and is loaded only while
learning mode is on. The mode is off by default and follows the active session
branch. These features use Pi's existing APIs and require no additional
packages. The `researcher` subagent is bundled with interactive-subagents and
uses the existing `web_search`, `web_fetch`, and `safe_bash` tools.

The `md-log` extension has no AI-facing tools, so its user commands remain
available independently of learning mode. Bare `/md-log` toggles logging; when
enabling, it asks for an existing Markdown file. Use `/md-log:link <path>` to
link or change the file and `/md-log:status` to inspect the state.

The interactive-subagents integration is deployed on Windows and Linux. Normal
Pi enables it when launched inside Herdr; `pi-lean` loads it but keeps it off
until `/subagents` is toggled on. Observational memory remains Linux-only and
normal-Pi-only, off until `/om` is toggled on.

After applying or changing extensions, restart Pi or use `/reload` as appropriate.

## Local llama.cpp

Use `/local` to start the local router if needed, load a configured profile, and
select it in Pi. Model/runtime/thinking settings live in
[`local-llama/models.json`](local-llama/models.json); see the
[setup and maintenance guide](local-llama/README.md). Generated files stay in
`~/.cache/pi-local-llama/`, weights stay on the SSD, and the API key stays outside
chezmoi.
