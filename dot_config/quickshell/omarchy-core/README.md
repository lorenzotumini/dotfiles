# Omarchy desktop core

This directory is the local integration boundary around the pinned, unmodified
Omarchy snapshot in `../omarchy-stock`.

The core exposes only:

- the upstream Quickshell host and desktop plugins;
- native Omarchy themes and the shared theme templates;
- a curated command surface generated from `commands.txt`;
- local adapters explicitly listed in `local-commands.txt`.

The Omarchy installer, package manager, migrations, application catalog, menu,
agents, and operating-system integration are not on the runtime `PATH`.
Desktop commands are exposed directly as `omarchy-theme-*`, `omarchy-bar`,
`omarchy-font-*`, and their other allowlisted names. A local `omarchy` facade
exists only for the small theme and shell-plugin command set expected by native
theme tools and community widgets. It rejects every package, menu, installer,
update, migration, and system-management route.

## Policy

`~/.config/omarchy/shell.json` is the user policy. Chezmoi creates it only when
it is absent, so changes made through bar/widget controls survive later applies.
The copy under `config/omarchy/` is the canonical safe fallback used when the
user file is invalid. The menu, updater, agents, reminder, clipboard, emoji,
developer gallery, and benchmark plugins are omitted or disabled. The stock
bar, workspaces, tray, audio, Bluetooth, network, monitor, power, weather,
lock, notification, OSD, idle, background, media, night-light, battery,
Polkit, Wi-Fi QR, and image picker components remain upstream code.

The screensaver timeout is intentionally set to one day while the lock timeout
remains five minutes. This preserves Omarchy's idle/lock service without adding
its animated `ttfx` screensaver dependency.

## Chezmoi ownership and interactive settings

Normally managed files contain structure: shell code, services, Hyprland
bindings, application includes, and the pinned theme library. Interactive
controls never rewrite those files.

Two files are create-once settings. Chezmoi supplies a new machine's initial
value, then the desktop owns them without reporting drift:

- `~/.config/omarchy/shell.json`: bar position/layout and inline widget options;
- `~/.config/hypr/monitors.lua`: monitor scale and its matching GTK scale.

To promote the current machine's choices to future machines, run
`chezmoi add --create` on the relevant file. Applying chezmoi does not push a
changed seed back onto a machine where the file already exists.

Generated and machine-local state is excluded from chezmoi:

- `~/.local/state/omarchy/`: current theme/wallpaper, notifications and DND,
  weather location, stay-awake, bar visibility, and remembered power profiles;
- `~/.local/state/desktop-core/`: font and interface-size choices plus
  generated Ghostty, Alacritty, and Fuzzel fragments;
- `~/.config/omarchy/shell.toml`: live shell text-size override;
- `~/.config/omarchy/themes/` and `backgrounds/`: user-installed assets.
- `~/.config/aether/` and `~/.local/share/aether/`: Aether blueprints and app
  state; Aether's generated native theme lives in the user theme directory
  above and is applied through the same current-theme boundary.

NetworkManager owns Wi-Fi connections, DNS and band selection; BlueZ/rfkill
own Bluetooth; PipeWire owns audio routing and volume; power-profiles-daemon
and the display hardware own their respective live settings. Panel visibility,
keyboard layout, monitor enable/disable, and night-light temperature are
intentionally session-scoped. None of these paths overlap a normally managed
chezmoi target.

`desktop-core-init` creates the command allowlist atomically and initializes
Tokyo Night only when no valid current theme exists. It also regenerates safe
font/text-size includes from machine state without editing application configs.

The curated facade supports only `omarchy version`, `theme set`, `theme bg
set`, `plugin list|validate|enable|disable`, and the safe `launch or focus tui`
route used by community widgets. Third-party plugin source is still installed
separately and reviewed before it is exposed to the shell.
The local `omarchy-launch-tui` adapter preserves upstream widget app IDs while
launching Ghostty directly; this system therefore does not need Omarchy's
`xdg-terminal-exec` assumption.

## Optional integrations

`optional-plugins.txt` records reviewed optional plugins without making network
checkouts part of `chezmoi apply`. The selected Analytics widget is installed
at `~/.config/omarchy/plugins/analytics-omarchy` at its recorded commit. Its
small reviewed compatibility or layout changes live under
`optional-plugin-patches/`; the Analytics patch only restores the compact
vertical alignment of its labels and is intentionally separate from the pinned
upstream checkout and must be reapplied after replacing or updating a plugin.

The managed `~/.local/bin/aether` wrapper points an optional Aether package at
this pinned Omarchy core. Aether then generates an ordinary native user theme
and applies it with the restricted facade, so the existing theme sync remains
responsible for the bar, terminal, Hyprland, wallpaper, GNOME, btop, and
Neovim. No Aether state is required for stock themes to continue working.

## Theme application boundary

Omarchy's generated current-theme directory remains the single palette source.
The shell, wallpaper, Ghostty, Alacritty, Hyprland, GNOME/Nautilus, and the
stock application hooks consume it directly. Fuzzel is added through
`~/.config/omarchy/themed/fuzzel.ini.tpl`, the upstream-supported template
extension point; its managed config only imports the generated result.

`desktop-theme-sync` is the small adapter for applications whose normal config
should remain mutable. It changes only btop's `color_theme` key and maintains
the stock `current.theme` symlink. It also writes a generated Neovim theme
event under `~/.local/state/desktop-core/`; it never edits Neovim's config.

On Linux, a new desktop-theme event takes precedence once in each terminal's
existing Neovim theme state. A manual Telescope/`:colorscheme` choice made
afterward remains remembered until the next desktop theme switch. Official
themes use the Neovim plugin and colorscheme declared by their native
`neovim.lua`; themes without one use the local palette-backed `omarchy`
colorscheme. Windows does not read the Linux desktop-theme event and retains
the previous independent Neovim behavior.

The Arch logo at the start of the bar is a local command widget that launches
the themed Fuzzel power/session chooser. It does not enable `omarchy.menu`.

The bar uses the local `desktop.stable-tray` wrapper around Omarchy's stock
tray. It keeps an expanded drawer stable while an item menu is open and hides
the tray's slot-wide underline; all tray discovery, rendering, menus, and
management remain in the upstream component.

## Small system boundary

The desktop core has three intentional system-level prerequisites:

- the normal runtime packages listed in `../omarchy-stock/UPSTREAM.md`;
- `/etc/pam.d/omarchy-lock-password`, for the native lock screen;
- `/usr/bin/omarchy-dns`, installed as an exact copy of the pinned vendor
  command so DNS changes can authenticate through Polkit.

No Omarchy sudoers rule is installed. Wi-Fi connection management itself is
unprivileged; only changing the system DNS provider asks for authorization.
When updating the vendor snapshot, compare and reinstall the DNS helper if it
changed.

Because the Omarchy menu is disabled, commands that normally ask it for a
selection need an explicit argument. For example, use
`omarchy-theme-remove "Theme Name"`; the future appearance panel can provide
that selection UI without restoring the system menu.

## Updating upstream

Update `omarchy-stock` as a single pinned unit, then review plugin manifests,
theme templates, and calls to `omarchy-*` from the selected plugins. Add a
command to `commands.txt` only when it belongs to the desktop boundary. Local
policy and adapters stay outside the vendor tree, so upstream files should not
need merging.

## Recovery

The desktop core is the only supported shell. `desktop-shell stop` stops it
without changing its profile; `desktop-shell core` starts it again. The former
Waybar, Mako, pilot Quickshell, and companion-service fallbacks are intentionally
not installed. The Aether package and community plugins are optional; disabling
a plugin or removing Aether does not affect the pinned desktop core or its stock
themes.
