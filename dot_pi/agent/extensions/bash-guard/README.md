# bash-guard

Heuristic checks for agent-issued `bash` tool calls. **Main sessions default to
OFF: no routine approval prompts, but the hard-block floor remains active.**

## Commands

| Command | Behavior |
|---|---|
| `/bash-guard on` | Enable approval prompts for flagged commands |
| `/bash-guard off` | Disable prompts; keep the hard-block floor |
| `/bash-guard status` | Report the current mode without changing it |
| `/bash-guard` | Toggle on/off (backward-compatible shorthand) |

`on` and `off` are idempotent. Invalid arguments show usage without changing mode.
The footer shows `BG off · floor on` or `BG on`.

Mode changes are session-local, not persisted. Reload, restart, new session and
resume initialize from CLI defaults (off unless `--bash-guard-enabled` is set).

## Off: hard-block floor (default)

Routine commands, including Git status, commits, pulls, ordinary pushes, pipes
and redirections, run without approval prompts. Existing catastrophic-command
patterns are still blocked, including:

- Recursive deletion (`rm -r`, combined flags such as `-fr`, `--recursive`)
- `sudo` and remote download piped to a shell
- Filesystem formatting, disk wiping, partition management, raw device writes,
  encryption management, and ZFS pool operations
- System shutdown/reboot and selected infrastructure deletion commands
- `git reset --hard`, forced `git clean`, reflog expiration and pruning
- Force pushes (`--force`, `--force-with-lease`, `-f`, `+refspec`)

To intentionally run a blocked command, use `/bash-guard on`, then review and
approve that specific command. Turning prompts off is **not** a bypass for the
hard-block floor. Ordinary non-recursive `rm` is not in this floor.

## On: approval prompts

The existing broad approval policy remains: prompt for any Git command, disk
management/listing commands, deletion, sudo, redirections, pipes, selected
in-place edits, recursive permissions changes, process termination and
infrastructure deletion.

Command names are checked by basename, including absolute paths such as
`/bin/rm`. Analysis inspects newline-separated commands, list operators,
pipelines, background jobs and subshell separators. Quoted newlines remain
inside arguments; escaped line continuations are joined; shell comments are
ignored by the line scanner.

The built-in selection dialog works in both TUI and RPC mode. **Abort is the
first choice**; cancellation blocks the command. Exact refusals are remembered
for 60 seconds to avoid retry loops. Changing modes clears this memory.

Without UI, flagged commands are blocked with an explicit explanation unless
`--bash-guard-auto-allow` is set (see below).

## CLI flags

| Flag | Behavior |
|---|---|
| `--bash-guard-enabled` | Opt into approval prompts at session initialization |
| `--bash-guard-disabled` | Explicit floor-only mode; retained for compatibility; wins if both mode flags are passed |
| `--bash-guard-auto-allow` | Without UI, use floor-only protection rather than blocking commands that would require approval |

`auto-allow` does not bypass catastrophic-command checks and does not suppress
prompts when UI is available. Flags are read using Pi's registered flag names,
without the CLI `--` prefix.

## Future subagent use

If `PI_SUBAGENT_DEPTH` is a finite number >= 1, the extension uses headless
hard-block rules without prompts or a mode toggle. In addition to the main
floor's catastrophic patterns, **all Git commits, pulls and pushes are blocked**.
Routine Git reads remain allowed. Main-session mode flags do not override this.

No subagent extension is installed or configured by bash-guard.

## Scope and limitations

- Only agent `bash` tool calls are intercepted. `write`, `edit`, user `!` commands,
  browser tools and other extensions' direct process execution are not covered.
- This is a heuristic convenience guard, **not a security sandbox or a complete
  Bash parser**. Do not rely on it to contain untrusted code or subagents.
- Shell wrappers (`env`, `command`, `bash -c`), variable expansion, substitutions,
  aliases, functions, heredocs and scripts can evade or confuse analysis.
- The hard-block floor retains regex-based matching, so text inside quoted
  arguments can produce false positives. Unusual quoting/option placement
  (including Git global options) can produce false negatives.
- Recursive-delete protection is not a general guarantee against file loss.
  Ordinary writes and many commands that can overwrite data remain allowed off.

## Loading and tests

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Use `/reload` after
changes. Runtime dependency: `shell-quote` (`npm ci --ignore-scripts` if missing).

```bash
npm --prefix ~/.pi/agent/extensions/bash-guard test
```

Tests load the extension through the installed Pi loader and invoke handlers
with simulated contexts. **Dangerous-looking command strings are never executed.**
They cover defaults, toggles, reload, CLI flags, RPC-compatible approval, refusal
memory, command path/newline regressions, force pushes and subagent behavior.

If Pi is installed somewhere unusual, set `PI_CODING_AGENT_PACKAGE` to its
package directory when running tests.
