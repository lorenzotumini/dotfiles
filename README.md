# dotfiles

Cross-platform dotfiles managed with [chezmoi](https://www.chezmoi.io/).
The Git repository is the source of truth; files in the home directory are
generated targets and do not propagate changes back automatically.

## Windows and Linux

Both operating systems use this repository. `.chezmoiignore` prevents complete
OS-specific trees from being created on the other OS: Windows skips Linux-only
configuration, while Linux skips `AppData`, PowerShell and other Windows-only
files.

Configuration shared by both systems uses one of three patterns:

- one identical source file or tree, as with Neovim;
- a shared chezmoi template with small OS-specific values, as with Herdr and
  Alacritty;
- one application-native configuration containing OS conditionals, as with
  WezTerm.

Neovim's only source tree is `dot_config/nvim`, applied as `~/.config/nvim` on
both systems. Windows also creates the junction
`~/AppData/Local/nvim -> ~/.config/nvim`, allowing Neovim to use its native path
without maintaining a second configuration copy.

Sioyek is stored once under `dot_config/sioyek`. Windows copies it to Sioyek's
required `C:\ProgramData\sioyek` location after apply; Linux uses it directly.

## First initialization

Install Git and chezmoi first. Windows also needs PowerShell 7 (`pwsh`) before
applying because the setup hooks use it. Chezmoi manages configuration files;
it does not install the applications or system packages they configure.

```sh
chezmoi init https://github.com/lorenzotumini/dotfiles.git
chezmoi diff
chezmoi apply
```

Review the diff before the first apply, especially on a machine with existing
configuration. On Windows, the Neovim hook deliberately stops if
`~/AppData/Local/nvim` is an existing real directory: preserve or import its
contents before replacing it with the managed junction.

The Linux GitHub SSH rule expects a machine-local `~/.ssh/id_ed25519_github`
key. Generate and register that key separately; private keys are never managed
by chezmoi.

## Workflow

Edit the source repository, inspect the result, and apply it locally:

```sh
chezmoi cd
# edit files
chezmoi diff
chezmoi apply
git add -A
git commit
git push
```

On another machine, pull and apply in one operation:

```sh
chezmoi update
```

If a target file was edited directly, use `chezmoi re-add <target>` before
committing to copy that change back into the source state.
