param(
  [string]$Repo = "uhtred1986-lab/trading-card-management",
  [string[]]$Issues,
  [switch]$AllClosed,
  [switch]$DryRun
)

# Marks completed Arena backlog issues as closed on GitHub, posts the acceptance proof,
# and refreshes tracking issues.
# Usage:
#   .\scripts\close-arena-backlog.ps1 -Issues "s2-01", "ui-108", "ui-101", "ui-102", "ui-103"
#   .\scripts\close-arena-backlog.ps1 -AllClosed

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Warning "GitHub CLI (gh) is not installed. You can also run: npx tsx scripts/sync-arena-backlog.mts with GITHUB_TOKEN set."
  exit 1
}

gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Not authenticated in GitHub CLI. Run: gh auth login"
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$issueDir = Join-Path $root "docs\arena-backlog"

$argsList = @()
if ($DryRun) { $argsList += "--dry-run" }
if ($AllClosed) { $argsList += "--all-closed" }
if ($Issues) {
  foreach ($iss in $Issues) {
    $argsList += "--close"
    $argsList += $iss
  }
}
$argsList += "--repo"
$argsList += $Repo

npx tsx (Join-Path $PSScriptRoot "sync-arena-backlog.mts") @argsList
