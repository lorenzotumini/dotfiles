# dotfiles

Personal configuration files managed with [chezmoi](https://www.chezmoi.io/).

## Components

- **shell**: pwsh + oh-my-posh
- **term**: Windows Terminal / WezTerm / Alacritty
- **editor**: Neovim
- **multiplexer**: Herdr

## Requirements

- chezmoi
- git
- Neovim **0.12+** on both Windows and Linux/WSL
- ripgrep for Telescope

On Linux avoid old distro Neovim packages if they are below 0.12.

## Layout

chezmoi applies different Neovim config trees depending on the OS:

| OS | source path | target path |
| --- | --- | --- |
| Windows | `AppData/Local/nvim` | `~/AppData/Local/nvim` |
| Linux / WSL | `dot_config/nvim` | `~/.config/nvim` |

The Linux/WSL config is kept aligned with the Windows config.

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
