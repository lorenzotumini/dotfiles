# Lightweight PowerShell profile for Neovim terminal.
# Keep this fast: no prompt themes, modules, or plugin initialization.

$env:EDITOR = "nvim"
$env:FZF_DEFAULT_COMMAND = "fd --type f --hidden --exclude .git"
$env:FZF_CTRL_T_COMMAND = $env:FZF_DEFAULT_COMMAND
$env:FZF_DEFAULT_OPTS = "--height 40% --layout=reverse"
$env:BAT_THEME = "ansi"
$env:RIPGREP_CONFIG_PATH = "$HOME\.ripgreprc"

function prompt {
    $path = (Get-Location).Path
    if ($path -like "$HOME*") {
        $path = $path -replace [regex]::Escape($HOME), "~"
    }
    $parts = $path -split '[\\/]'
    if ($parts.Count -gt 3) {
        $path = ".../" + (($parts | Select-Object -Last 2) -join "/")
    }
    Write-Host "$path ⮞" -ForegroundColor Blue -NoNewline
    return " "
}

Set-Alias cat bat
Set-Alias find fd
Set-Alias grep rg
Set-Alias v nvim

function .. { Set-Location .. }
function ... { Set-Location ../.. }
function ll { Get-ChildItem @args }
function gitree { git log --graph --oneline --all --decorate --color=always }
