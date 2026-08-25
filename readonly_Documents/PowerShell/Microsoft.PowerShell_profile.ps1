# -------- TIMING DIAGNOSTICS --------
# enable with "$env:PROFILE_TIMING = 1; pwsh"
if ($env:PROFILE_TIMING) {
	$__swTotal = [System.Diagnostics.Stopwatch]::StartNew()
	$__sw = [System.Diagnostics.Stopwatch]::StartNew()
	function __step($name) {
		Write-Host ("{0,-28} {1,6:N0} ms" -f $name, $__sw.ElapsedMilliseconds) -ForegroundColor DarkGray
		$__sw.Restart()
	}
} else {
	function __step($name) {}
}

# -------- CORE SETTINGS --------
Set-PSReadLineOption -EditMode Vi

function OnViModeChange($mode) {
	if ($mode -eq 'Command') {
		Write-Host -NoNewline "`e[1 q"
	} else {
		Write-Host -NoNewline "`e[5 q"
	}
}

Set-PSReadLineOption -ViModeIndicator Script -ViModeChangeHandler $Function:OnViModeChange
Set-PSReadLineOption -HistoryNoDuplicates
Set-PSReadLineOption -MaximumHistoryCount 10000
# Prefix a sensitive command with a space to keep it out of PSReadLine history.
# This also prevents inline history predictions from resurfacing that command.
Set-PSReadLineOption -AddToHistoryHandler {
	param([string]$line)
	return -not [string]::IsNullOrEmpty($line) -and -not [char]::IsWhiteSpace($line[0])
}
Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete

if ($Host.UI.SupportsVirtualTerminal) {
	try {
		Set-PSReadLineOption -PredictionSource HistoryAndPlugin
	} catch {}
	Set-PSReadLineOption -PredictionViewStyle InlineView #ListView
	Set-PSReadLineOption -Colors @{ InlinePrediction = "`e[38;5;244m" }
}

$ErrorView = "ConciseView"
__step "PSReadLine core"

# -------- PROMPT (Oh My Posh + fallback) --------
# https://windowsterminalthemes.dev/
$ompConfig = "$HOME\AppData\Local\posh\my-config.omp.json"

if (Get-Command oh-my-posh -ErrorAction SilentlyContinue) {
	oh-my-posh init pwsh --config $ompConfig | Invoke-Expression
} else {
	function prompt {
		$path = (Get-Location).Path
		if ($path -like "$HOME*") {
			$path = $path -replace [regex]::Escape($HOME), '~'
		}
		$parts = $path -split '[\\/]'
		if ($parts.Count -gt 3) {
			$path = ".../" + (($parts | Select-Object -Last 2) -join "/")
		}
		Write-Host "$path ⮞" -ForegroundColor Blue -NoNewline
		return " "
	}
}
__step "Prompt (oh-my-posh)"

# -------- ENVIRONMENT --------
$env:EDITOR = "nvim"
$env:FZF_DEFAULT_COMMAND = "fd --type f --hidden --exclude .git"
$env:FZF_CTRL_T_COMMAND = $env:FZF_DEFAULT_COMMAND
$env:FZF_DEFAULT_OPTS = "--height 40% --layout=reverse"
$env:FZF_CTRL_T_OPTS = "--preview 'bat --color=always --style=plain --line-range=:200 {}'"
$env:FZF_CTRL_R_OPTS = "--preview 'echo {} | bat --color=always --language=sh'"
$env:BAT_THEME = "ansi"
$env:RIPGREP_CONFIG_PATH = "$HOME\.ripgreprc"
__step "Environment vars"

# -------- MODULES --------
Import-Module posh-direnv -ErrorAction SilentlyContinue
__step "  Modules: registration"

# deferred to PowerShell's idle event
Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -MaxTriggerCount 1 -Action {
	Import-Module Microsoft.WinGet.CommandNotFound -ErrorAction SilentlyContinue
	Import-Module PSFzf -ErrorAction SilentlyContinue
	Import-Module Terminal-Icons -ErrorAction SilentlyContinue
	if (Get-Module PSFzf) {
		Set-PsFzfOption -PSReadlineChordReverseHistory 'Ctrl+r'
		Set-PsFzfOption -PSReadlineChordProvider 'Ctrl+t'
		Set-PsFzfOption -PSReadlineChordSetLocation 'Alt+c'
	}
} | Out-Null
__step "  Modules: deferred registration"


# -------- EXTERNAL TOOLS INIT --------
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}
__step "External tools: zoxide"

# -------- ALIASES --------
Set-Alias cat bat
Set-Alias find fd
Set-Alias grep rg
Set-Alias v nvim
Set-Alias wc cloc
Set-Alias fastcp robocopy
# https://github.com/openai/codex/issues/17112
# set sanbox settings in .codex/config.toml
Set-Alias cx codex

function .. { Set-Location .. }
function ... { Set-Location ../.. }

# -------- FUNCTIONS --------
if (Get-Command eza -ErrorAction SilentlyContinue) {
	function ll {
		eza --color=always --long --git --icons=always --no-user --no-time @args
	}
} else {
	function ll {
		Get-ChildItem @args
	}
}

function gitree {
	git log --graph --oneline --all --decorate --color=always
}

function nvims {
	if (-not $env:NVIM_LISTEN_ADDRESS) {
		$env:NVIM_LISTEN_ADDRESS = "127.0.0.1:6666"
	}
	nvim --listen $env:NVIM_LISTEN_ADDRESS @args
}

function zv {
	param ([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
	if (Get-Command z -ErrorAction SilentlyContinue) {
		z @Args
		nvim
	}
}

function fedit {
	nvim (fd --type f | fzf --preview "bat --style=numbers --color=always {}")
}

function dif {
	param([string]$file1, [string]$file2)
	git diff --no-index $file1 $file2
}

function psln ($target, $link) {
	New-Item -Path $link -ItemType SymbolicLink -Value $target
}

function start-claude-local {
    $env:ANTHROPIC_AUTH_TOKEN="freecc"
    $env:ANTHROPIC_BASE_URL="http://localhost:8082"
    claude
}

function ccc {
    $cwd = (Get-Location).Path
    $configDir = Join-Path $HOME ".config/free-claude-code"

    if ($env:WT_SESSION) {
        wt -w 0 new-tab -d "$configDir" -p "PowerShell" free-claude-code
        wt -w 0 new-tab -d "$cwd" -p "PowerShell" pwsh -NoLogo -NoExit -Command "start-claude-local"
    }
    else {
        Start-Process free-claude-code -WorkingDirectory "$configDir"
        start-claude-local
    }
}

function hist {
	nvim (Get-PSReadLineOption).HistorySavePath
}

function lines {
    [CmdletBinding()]
    param(
        [Parameter(Position=0, ValueFromRemainingArguments=$true)]
        [string[]]$ext,

        [string]$path = "."
    )

    if (-not (Test-Path $path)) {
        Write-Error "The path '$path' does not exist."
        return
    }

    $fullPath = (Resolve-Path $path).Path

    if (Test-Path (Join-Path $fullPath ".git")) {
        $files = (git -C $fullPath ls-files) -replace '\r$' | ForEach-Object { Join-Path $fullPath $_ }
    } else {
        $files = Get-ChildItem -Path $fullPath -Recurse -File | Select-Object -ExpandProperty FullName
    }

    if ($ext) {
        $extset = $ext | ForEach-Object { if ($_ -notmatch '^\.') { ".$_" } else { $_ } }
        $files = $files | Where-Object { $extset -contains [IO.Path]::GetExtension($_) }
    }

    if (-not $files) { Write-Host "no matching files."; return }

    $results = $files | Where-Object { Test-Path $_ } | ForEach-Object {
        [PSCustomObject]@{ lines = @(Get-Content $_).Count; file = $_ }
    } | Sort-Object lines -Descending

    $results | Format-Table -AutoSize
    "`ntotal lines: $(($results | Measure-Object lines -Sum).Sum)"
}

function fetch { fastfetch -c examples/13 }
function ncdu { dua i }
function ascii { less "$HOME\.local\share\ascii.txt" }

function Start-Conda {
	$condaPath = "$HOME\miniforge3\Scripts\conda.exe"
	if (Test-Path $condaPath) {
		(& $condaPath "shell.powershell" "hook") | Out-String | Invoke-Expression
		Write-Host "Conda initialized" -ForegroundColor Green
	} else {
		Write-Host "Conda not found" -ForegroundColor Red
	}
}
Set-Alias condaactivate Start-Conda
__step "Aliases & functions"

# -------- CUSTOM SCRIPTS --------
# . "$HOME\Documents\PowerShell\Scripts\venv.ps1"
# __step "venv.ps1"
# . "$HOME\Documents\PowerShell\Scripts\ai.ps1"
# __step "ai.ps1"

if ($env:PROFILE_TIMING) {
	Write-Host ("{0,-28} {1,6:N0} ms" -f "TOTAL", $__swTotal.ElapsedMilliseconds) -ForegroundColor Yellow
}
