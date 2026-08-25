# dotfiles

Personal configuration files managed with [chezmoi](https://www.chezmoi.io/).

## Components

- **Windows shell**: PowerShell + Oh My Posh
- **Linux shell**: Zsh + Starship
- **Windows term**: Windows Terminal / WezTerm / Alacritty
- **Linux terminal**: Ghostty
- **editor**: Neovim
- **multiplexer**: Herdr
- **PDF reader**: Sioyek

## Requirements

- chezmoi
- git
- PowerShell 7 (`pwsh`) on Windows
- Neovim **0.12+** on both Windows and Linux/WSL
- ripgrep for Telescope

On Linux avoid old distro Neovim packages if they are below 0.12.

## Layout

Neovim has one canonical configuration tree on every OS:

| OS | source path | target path |
| --- | --- | --- |
| Windows | `dot_config/nvim` | `~/.config/nvim` |
| Linux / WSL | `dot_config/nvim` | `~/.config/nvim` |

On Windows, an idempotent post-apply script creates the directory junction
`~/AppData/Local/nvim -> ~/.config/nvim`. Neovim therefore finds the config in
its native Windows location while both systems use the exact same physical
files. The junction also keeps `stdpath("config")` behavior compatible with
plugins and the existing configuration.

## Shell history and secrets

Shell history is machine-local and is not managed by chezmoi. On both PowerShell
and Zsh, prefix a sensitive command with one space to prevent it from being saved
or resurfacing as an inline autosuggestion. Prefer `secret-env VARIABLE_NAME` on
Zsh, password-manager integration, or a tool's standard-input/file option over
putting a secret directly on a command line.

## Application configuration

Ghostty, Herdr, and Sioyek are managed here as user configuration. Herdr uses a
shared template with `pwsh` on Windows and `zsh` on Linux. Sioyek is stored at
`~/.config/sioyek` on both systems; on Windows an idempotent `run_onchange`
script also copies changes to the application's active `C:\ProgramData\sioyek`
directory after `chezmoi apply`.

On the NVIDIA Linux workstation, Sioyek is launched through a user-level
wrapper with `QT_QPA_PLATFORM=xcb`; its native Qt Wayland/OpenGL path starts a
process but fails to create a window. Hyprland disables fractional resampling
for XWayland, while the wrapper applies `QT_SCALE_FACTOR=1.25`, keeping the
fallback sharp and scoped to Sioyek.

Alacritty's active configuration and Carbonfox theme are shared templates, with
an OS-specific shell. WezTerm uses one Lua configuration that selects PowerShell
on Windows and Zsh on Linux; Windows-only backdrop and positioning behavior is
guarded accordingly. These configs remain reproducible even on a machine where
the optional terminal itself is not installed.

## Windows setup

```powershell
chezmoi init <repo-url>
chezmoi diff
chezmoi apply
```

## Linux / WSL setup

Use native Linux paths inside WSL, not `/mnt/c/...`.

```bash
sudo apt update
sudo apt install -y git curl ripgrep fd-find build-essential unzip
# Install Neovim 0.12+ from an upstream release/AppImage/bob/mise/etc.
chezmoi init <repo-url>
chezmoi diff
chezmoi apply
nvim --version
nvim --headless '+Lazy sync' '+qa'
```
