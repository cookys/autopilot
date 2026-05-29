# install-antigravity.ps1 — Windows counterpart to install-antigravity.sh.
#
# verified-against: agy 1.0.1 empirical (Linux), 2026-05-29. The agy plugin
# model is platform-agnostic (CLI subcommands identical); the PowerShell port
# mirrors the bash logic. NOT the codelabs ~/.gemini/antigravity/skills/ symlink
# approach (that is not how agy's plugin mechanism works).
#
# Real agy plugin model: validate <path> → install <path> → list / uninstall <name>.

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

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
