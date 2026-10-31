# Windows terminal workarounds

These workarounds apply only on Windows, including Windows Terminal. Linux and
macOS retain their existing settings and color-query behavior.

## Color replies opening the editor

Alacritty and WezTerm's ConPTY paths can deliver palette replies without their
OSC headers. The remaining `rgb:...` text enters Pi's prompt, and a BEL terminator
becomes Ctrl+G, launching the external editor. Queries can recur during startup,
`/reload`, or `/resume`. See [Pi issue #10256](https://github.com/earendil-works/pi/issues/10256).

This extension wraps `queryTerminalColors()` in both Pi screen classes before
startup to skip those queries on Windows. Reloading does not stack wrappers.
Use an explicit Pi theme such as `dark` or `light`; the system theme and automatic
terminal appearance detection cannot read the terminal palette with this patch.

To restore queries after an upstream fix, set
`$env:PI_TERMINAL_COLOR_QUERIES = '1'` before launching Pi, or remove this
extension and restart Pi.

## Touchpad scrolling cycles prompt history

The chezmoi source file `agent/modify_settings.json` enforces
`"tuiMode": "regular"` in `~/.pi/agent/settings.json` on Windows, preserving all
other settings. The non-Windows branch of `.chezmoiignore` excludes that target.

Regular mode uses the terminal's scrollback instead of fullscreen mouse
reporting. The editor and footer scroll with the conversation. Change or remove
the modifier, set `"tuiMode": "fullscreen"`, and restart Pi to restore the pinned
editor and application-managed scrolling.

Regression checks: `node ~/.pi/agent/tests/windows-terminal-colors.mjs`.
These exercise Pi's runtime with simulated input; live terminal behavior still
needs to be checked in the affected terminal.
