# setup-symlinks.ps1 — Windows counterpart to setup-symlinks.sh.
#
# Requires Developer Mode (ms-settings:developers) OR running as Administrator
# to create symbolic links. Without one of these, `New-Item -ItemType
# SymbolicLink` throws UnauthorizedAccessException.
#
# Idempotent — safe to re-run.

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

$links = @{
    ".agents\skills" = "..\skills"   # cross-agent intersection path
}

foreach ($pair in $links.GetEnumerator()) {
    $link = Join-Path $repo $pair.Key
    $target = $pair.Value
    $linkDir = Split-Path -Parent $link

    if (-not (Test-Path $linkDir)) {
        New-Item -ItemType Directory -Force -Path $linkDir | Out-Null
    }

    if (Test-Path $link) {
        $item = Get-Item $link -Force
        if ($item.LinkType -eq "SymbolicLink" -and $item.Target -eq $target) {
            Write-Host "OK   $($pair.Key) -> $target (already correct)"
            continue
        }
        Write-Host "FIX  $($pair.Key): replacing existing entry"
        Remove-Item -Force -Recurse $link
    } else {
        Write-Host "NEW  $($pair.Key) -> $target"
    }

    try {
        New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
    } catch [System.UnauthorizedAccessException] {
        Write-Error @"
Symlink creation requires Developer Mode (ms-settings:developers) or
elevated privileges. Steps:
  1. Open Settings -> Privacy & security -> For developers
  2. Enable Developer Mode
  3. Re-run this script in a NEW PowerShell window
Alternatively, run PowerShell as Administrator.
"@
        exit 2
    }
}

Write-Host ""
Write-Host "verify: (Get-Item .agents\skills).Target  # should print '..\skills'"
