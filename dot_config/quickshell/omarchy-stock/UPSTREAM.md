# Stock Omarchy shell profile

This profile vendors the Omarchy 4.0.1 shell from upstream commit
`13f18b2cb7286fb54f87daf571a031aa6af3d8f0`.

Upstream: <https://github.com/basecamp/omarchy>

The `shell`, `bin`, `config`, `default`, and `applications` trees are copied
from that release. Executable files only carry chezmoi's `executable_` source
prefix; their installed names and contents remain upstream-compatible.

The complete set of 22 themes from the pinned release is included. Theme
files, previews, backgrounds, and templates remain byte-for-byte upstream;
mutable selections live outside this tree.

The runtime does not put this snapshot's complete `bin/` tree on `PATH`.
`../omarchy-core` exposes a reviewed command allowlist and symlinks the shell,
theme, and template boundaries into a smaller desktop-only profile.

Local integration is deliberately outside the vendored trees: systemd user
units select between this profile, the earlier curated profile, and the
original Waybar desktop. The full Omarchy package is not installed because it
also owns bootloader, display-manager, and system-wide distribution settings.

Runtime packages added for this profile:

- Direct: `brightnessctl`, `ddcutil`, `gum`, `hyprsunset`, `inotify-tools`,
  `jq`, `libvips`, `power-profiles-daemon`, `qrencode`, `uwsm`, `wtype`, and
  `yaru-icon-theme` (AUR; provides the per-theme Nautilus folder colors).
- Dependencies pulled by pacman: `cfitsio`, `i2c-tools`, `imath`, `libcgif`,
  `libimagequant`, `openexr`, `openjph`, `python-dbus`, and `python-pyxdg`.

The upstream `/etc/pam.d/omarchy-lock-password` policy is installed so the
Quickshell lock screen can authenticate. The pinned `omarchy-dns` helper is
also installed at `/usr/bin/omarchy-dns`; no passwordless sudo rule is used,
so DNS changes go through graphical Polkit authorization. Both are unused when
the desktop-core profile is not running.
