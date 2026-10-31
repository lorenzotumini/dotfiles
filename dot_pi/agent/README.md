# Pi user configuration

Chezmoi deploys this directory to `~/.pi/agent/`. It contains extensions, skills,
and optional integrations. Authentication, sessions, trust, model-store state,
and most settings remain local. On Windows, the settings modifier manages only
`tuiMode`; see [terminal workarounds](extensions/windows-terminal-colors/README.md).

## Features

| Feature | Entry point / guide |
|---|---|
| Web search and page/PDF extraction | [web-search](extensions/web-search/README.md), [web-fetch](extensions/web-fetch/README.md) |
| Interactive browser | `/browser` — [setup and usage](extensions/browser/README.md) |
| Shell command checks | `/bash-guard` — [behavior and defaults](extensions/bash-guard/README.md) |
| Herdr subagents | `/subagents` — [requirements and usage](extensions/interactive-subagents/README.md) |
| Observational memory | `/om` — [opt-in, Linux only](extensions/observational-memory/README.md) |
| Learning, quizzes, Markdown logging | `/learn`, `/learn:status`, `/md-log`, `/md-log:status` — [implementation](extensions/learn/index.ts) |
| Code sloppiness reports | `/sloppiness` — [usage and dependencies](extensions/sloppiness/README.md) |
| Local llama.cpp models | `/local` — [setup and maintenance](local-llama/README.md) |
| UI helpers | [balanced footer](extensions/footer-layout/README.md), [user questions](extensions/ask-user-question.ts) |
| Herdr pane status | [Herdr-managed integration](extensions/herdr-agent-state.ts) |

Skills cover session analysis, PDFs, YouTube transcripts, ComfyUI, web debugging,
and tldraw. Each lives under `skills/` with its own `SKILL.md`. The tldraw skill
uses a [manually maintained copy](skills/manual/tldraw-offline/README.md).

## Setup

Chezmoi tracks source and lockfiles, not generated dependencies. Install the
extension dependencies after deployment:

```sh
cd ~/.pi/agent
npm --prefix extensions/bash-guard ci --ignore-scripts
npm --prefix extensions/browser ci --ignore-scripts
npm --prefix extensions/web-fetch ci --ignore-scripts
npm --prefix extensions/web-search ci --ignore-scripts
```

Follow the browser guide to install Chromium, and the subagent/memory guides
for dependencies under `optional/`. Skills list their own prerequisites; keep
Python environments and downloaded assets outside the tracked source tree.

Restart Pi or use `/reload` after extension changes. Learning and memory start
off; subagents require a Herdr-managed pane. Linux also has a `pi-lean` launcher
with a restricted extension set and no automatic skill discovery.
