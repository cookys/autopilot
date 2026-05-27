# install-antigravity.ps1 — Windows counterpart to install-antigravity.sh.
#
# verified-against: codelabs walkthrough 2026-05-22; antigravity.google/docs/skills
# Path is from a Google codelabs tutorial, not a stable spec — re-verify
# with `agy --version` if Google updates the CLI.
#
# Requires Developer Mode or elevated PowerShell (see setup-symlinks.ps1).

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$destRoot = Join-Path $env:USERPROFILE ".gemini\antigravity\skills"
$link = Join-Path $destRoot "autopilot"
$target = Join-Path $repo "skills"

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -eq "SymbolicLink" -and $item.Target -eq $target) {
        Write-Host "OK: already installed ($link -> $target)"
        exit 0
    }
    Write-Error "$link exists and is not the expected symlink. Remove manually to overwrite."
    exit 2
}

try {
    New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
    Write-Host "installed: $link -> $target"
} catch [System.UnauthorizedAccessException] {
    Write-Error @"
Symlink creation requires Developer Mode (ms-settings:developers) or
elevated privileges. See setup-symlinks.ps1 message for steps.
"@
    exit 2
}

Write-Host ""
Write-Host "verify (if agy is installed):"
Write-Host "  agy skills list | Select-String 'autopilot|finish-flow|dev-flow'"
