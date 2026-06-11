# install-antigravity.ps1 — Windows counterpart to install-antigravity.sh.
#
# verified-against: agy 1.0.1 empirical (Linux), 2026-05-29. The agy plugin
# model is platform-agnostic (CLI subcommands identical); the PowerShell port
# mirrors the bash logic. NOT the codelabs ~/.gemini/antigravity/skills/ symlink
# approach (that is not how agy's plugin mechanism works).
#
# Real agy plugin model: validate <path> → install <path> → list / uninstall <name>.
#
# DATA-LOSS GUARD (confirmed 2026-06-11, still present in agy 1.0.7): a symlinked
# destination ~/.gemini/config/plugins/<name> makes `agy plugin install`
# self-copy-truncate the SOURCE repo. Mirror of the bash guards; the symlink
# check is never bypassable. See references/multi-agent-portability.md § agy spike.

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

# Feature-gap note vs the bash script: no --skip-git-checks / --preflight-only /
# AUTOPILOT_REPO_OVERRIDE here — the PS1 mirror is guard-equivalent but
# stricter (no bypass flags). Guards use Write-Host + exit (not Write-Error,
# which under $ErrorActionPreference=Stop throws before any exit line runs).

# Guard 1 (never bypassable): symlinked destination = confirmed kill condition.
$dest = Join-Path $HOME ".gemini/config/plugins/autopilot"
if (Test-Path $dest) {
    $item = Get-Item $dest -Force
    if ($item.LinkType) {
        Write-Host "ERROR: $dest is a $($item.LinkType) (-> $($item.Target)). agy plugin install follows it and self-copy-truncates the TARGET (confirmed data-loss bug, agy <= 1.0.7). Inspect the target, then remove the link itself before retrying." -ForegroundColor Red
        exit 1
    }
}

# Guards 2+3: require a clean, fully-pushed GIT repo (recovery depends on git).
git -C $repo rev-parse --git-dir 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: $repo is not a git repository - cannot verify it is recoverable. Install from a sacrificial clone instead." -ForegroundColor Red
    exit 1
}
if (git -C $repo status --porcelain) {
    Write-Host "ERROR: $repo has uncommitted changes. Commit/stash first, or install from a sacrificial clone." -ForegroundColor Red
    exit 1
}
if (git -C $repo log --branches --not --remotes --oneline 2>$null | Select-Object -First 1) {
    Write-Host "ERROR: $repo has unpushed commits. Push first, or install from a sacrificial clone." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command agy -ErrorAction SilentlyContinue)) {
    Write-Error "agy (Antigravity CLI) not found on PATH. Install Antigravity first: https://antigravity.google/"
    exit 1
}

$rootManifest = Join-Path $repo "plugin.json"
if (-not (Test-Path $rootManifest)) {
    Write-Error "$rootManifest missing — agy validate requires the root manifest. Run: node scripts/sync-version.js --check"
    exit 1
}

Write-Host "== validate =="
agy plugin validate $repo

Write-Host ""
Write-Host "== install =="
agy plugin install $repo

Write-Host ""
Write-Host "== verify =="
agy plugin list
Write-Host ""
Write-Host "autopilot registered as an agy plugin. To remove: agy plugin uninstall autopilot"
