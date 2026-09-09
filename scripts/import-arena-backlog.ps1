param(
  [string]$Repo = "uhtred1986-lab/trading-card-management",
  [switch]$DryRun,
  [switch]$UpdateExisting
)

# Creates (and with -UpdateExisting rewrites) the Arena backlog on GitHub from
# docs/arena-backlog/*.md — see docs/arena-backlog.md §6 and docs/arena-backlog/_README.md.
# Idempotent: issues are matched by exact title; milestones and labels are created only when
# absent; every tracking issue's task list is rebuilt from the current issue numbers each run.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$issueDir = Join-Path $root "docs\arena-backlog"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Assert-GhReady {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is not installed. Install it first: https://cli.github.com/"
  }
  gh auth status 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) { throw "You are not authenticated. Run: gh auth login" }
}

function Read-IssueFile {
  param([string]$Path)
  $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $lines = $text -split "`r?`n"
  if ($lines[0] -ne "---") { throw "${Path}: no front matter" }
  $meta = @{}
  $i = 1
  while ($i -lt $lines.Count -and $lines[$i] -ne "---") {
    $line = $lines[$i]
    $idx = $line.IndexOf(":")
    if ($idx -lt 0) { throw "${Path}: bad front matter line '$line'" }
    $meta[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
    $i++
  }
  if ($i -ge $lines.Count) { throw "${Path}: front matter never closed" }
  $body = ($lines[($i + 1)..($lines.Count - 1)] -join "`n").Trim()
  foreach ($k in "title", "milestone", "labels", "stage") {
    if (-not $meta.ContainsKey($k)) { throw "${Path}: front matter lacks '$k'" }
  }
  return [pscustomobject]@{
    File      = [System.IO.Path]::GetFileName($Path)
    Title     = $meta.title
    Milestone = $meta.milestone
    Labels    = @($meta.labels -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    Stage     = $meta.stage
    Tracking  = ($meta.ContainsKey("tracking") -and $meta.tracking -eq "true")
    Body      = $body
  }
}

function Get-AllIssues {
  $json = gh issue list --repo $Repo --state all --limit 1000 --json number,title,state
  if ([string]::IsNullOrWhiteSpace($json)) { return @() }
  return @($json | ConvertFrom-Json)
}

function Ensure-Milestone {
  param([string]$Title, [hashtable]$Existing)
  if ($Existing.ContainsKey($Title)) { return $Existing[$Title] }
  if ($DryRun) { Write-Host "  [dry] would create milestone: $Title"; return -1 }
  $created = gh api "repos/$Repo/milestones" -f title="$Title" -f state="open" | ConvertFrom-Json
  Write-Host "  milestone created: $Title"
  $Existing[$Title] = [int]$created.number
  return [int]$created.number
}

function Ensure-Label {
  param([string]$Name, [string]$Color, [string]$Description)
  if ($DryRun) { return }
  gh label create "$Name" --repo $Repo --color "$Color" --description "$Description" --force 1>$null
}

function Write-BodyFile {
  param([string]$Body)
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $Body, $utf8NoBom)
  return $tmp
}

function Expand-Children {
  param([pscustomobject]$Issue, [array]$All, [hashtable]$Numbers, [array]$Existing)
  $rows = @()
  foreach ($child in ($All | Where-Object { -not $_.Tracking -and $_.Stage -eq $Issue.Stage } | Sort-Object File)) {
    $n = $Numbers[$child.Title]
    if (-not $n) { $rows += "- [ ] $($child.Title) (not created yet)"; continue }
    $state = ($Existing | Where-Object { $_.number -eq $n } | Select-Object -First 1).state
    $box = if ($state -eq "CLOSED") { "[x]" } else { "[ ]" }
    $rows += "- $box #$n $($child.Title)"
  }
  return $Issue.Body.Replace("{{children}}", ($rows -join "`n"))
}

function Publish-Issue {
  param([pscustomobject]$Issue, [string]$Body, [hashtable]$Milestones, [array]$Existing, [hashtable]$Numbers)
  $match = $Existing | Where-Object { $_.title -eq $Issue.Title } | Select-Object -First 1
  $labelsCsv = ($Issue.Labels -join ",")
  if ($match) {
    $Numbers[$Issue.Title] = [int]$match.number
    if ($UpdateExisting -or $Issue.Tracking) {
      if ($DryRun) { Write-Host "  [dry] would update #$($match.number): $($Issue.Title)"; return }
      $tmp = Write-BodyFile $Body
      try {
        gh issue edit $match.number --repo $Repo --body-file $tmp --add-label "$labelsCsv" --milestone "$($Issue.Milestone)" 1>$null
      } finally { Remove-Item $tmp -Force }
      Write-Host "  updated #$($match.number): $($Issue.Title)"
    } else {
      Write-Host "  exists  #$($match.number): $($Issue.Title)"
    }
    return
  }
  if ($DryRun) { Write-Host "  [dry] would create: $($Issue.Title)  [$labelsCsv] {$($Issue.Milestone)}"; return }
  # gh issue create's --milestone flag expects the milestone's title, not its numeric id.
  $tmp = Write-BodyFile $Body
  try {
    $url = gh issue create --repo $Repo --title "$($Issue.Title)" --body-file $tmp --label "$labelsCsv" --milestone "$($Issue.Milestone)"
  } finally { Remove-Item $tmp -Force }
  $number = [int]($url -replace ".*/", "")
  $Numbers[$Issue.Title] = $number
  Write-Host "  created #${number}: $($Issue.Title)"
}

Assert-GhReady

$labels = @(
  @{ Name = "backlog"; Color = "1D76DB"; Description = "Arena backlog tracking item" },
  @{ Name = "ready-for-agent"; Color = "0E8A16"; Description = "Issue is pickup-ready for a future agent" },
  @{ Name = "needs-owner-ruling"; Color = "B60205"; Description = "Blocked pending owner ruling" },
  @{ Name = "blocked"; Color = "D93F0B"; Description = "Blocked by external dependency or prior task" },
  @{ Name = "epic"; Color = "3E4B9E"; Description = "A stage's tracking issue; its task list is the stage's progress" },
  @{ Name = "area:arena-compiler"; Color = "5319E7"; Description = "Arena compiler/parser work (compile.ts, filters.ts, the drafter)" },
  @{ Name = "area:arena-engine"; Color = "5319E7"; Description = "Legacy arena engine (src/lib/arena/engine)" },
  @{ Name = "area:arena-vm"; Color = "5319E7"; Description = "Rules engine (src/lib/arena/vm)" },
  @{ Name = "area:arena-lang"; Color = "5319E7"; Description = "The rules language (src/lib/arena/lang)" },
  @{ Name = "area:arena-rulesets"; Color = "5319E7"; Description = "Ruleset definition files and loader (src/lib/arena/rulesets)" },
  @{ Name = "area:arena-ui"; Color = "5319E7"; Description = "Arena UI and board experience work" },
  @{ Name = "area:arena-contract"; Color = "5319E7"; Description = "Arena snapshot/API contract work" },
  @{ Name = "area:arena-android"; Color = "5319E7"; Description = "Arena Android client work" },
  @{ Name = "area:arena-workbench"; Color = "5319E7"; Description = "Arena rules workbench workflow" },
  @{ Name = "area:arena-docs"; Color = "5319E7"; Description = "Arena documentation (language, ruleset, guides)" },
  @{ Name = "phase:rules-stage2"; Color = "C2E0C6"; Description = "Rules programme Stage 2: primitives and compiler correctness" },
  @{ Name = "phase:rules-stage3"; Color = "C2E0C6"; Description = "Rules programme Stage 3: definitions in the language" },
  @{ Name = "phase:rules-stage4"; Color = "C2E0C6"; Description = "Rules programme Stage 4: rules engine core" },
  @{ Name = "phase:rules-stage5"; Color = "C2E0C6"; Description = "Rules programme Stage 5: actions and costs" },
  @{ Name = "phase:rules-stage6"; Color = "C2E0C6"; Description = "Rules programme Stage 6: battle" },
  @{ Name = "phase:rules-stage7"; Color = "C2E0C6"; Description = "Rules programme Stage 7: keywords as macros" },
  @{ Name = "phase:rules-stage8"; Color = "C2E0C6"; Description = "Rules programme Stage 8: everything else from config" },
  @{ Name = "phase:rules-stage9"; Color = "C2E0C6"; Description = "Rules programme Stage 9: parity and the flip" },
  @{ Name = "phase:rules-stage10"; Color = "C2E0C6"; Description = "Rules programme Stage 10: retire the legacy engine" },
  @{ Name = "phase:rules-docs"; Color = "C2E0C6"; Description = "Rules programme documentation" },
  @{ Name = "phase:hud-workflow"; Color = "C2E0C6"; Description = "Arena HUD/workflow completion scope" },
  @{ Name = "phase:battle-staging"; Color = "C2E0C6"; Description = "Arena battle staging scope" },
  @{ Name = "phase:android-client"; Color = "C2E0C6"; Description = "Arena Android client scope" },
  @{ Name = "phase:capability-gap"; Color = "C2E0C6"; Description = "Arena engine capability-gap scope" },
  @{ Name = "model:opus-5"; Color = "FBCA04"; Description = "Plan recommends running this on Opus 5 (design, engine, keywords)" },
  @{ Name = "model:sonnet-5"; Color = "FEF2C0"; Description = "Plan recommends running this on Sonnet 5 (mechanical ports, UI, docs)" }
)

Write-Host "Reading $issueDir ..."
$issues = @(Get-ChildItem -Path $issueDir -Filter "*.md" | Where-Object { $_.Name -notlike "_*" } | ForEach-Object { Read-IssueFile $_.FullName })
Write-Host "  $($issues.Count) issue files ($(@($issues | Where-Object Tracking).Count) tracking)"

$dupes = $issues | Group-Object Title | Where-Object { $_.Count -gt 1 }
if ($dupes) { throw "Duplicate titles: $($dupes.Name -join '; ')" }

Write-Host "Ensuring milestones..."
$milestones = @{}
$existingJson = gh api "repos/$Repo/milestones?state=all&per_page=100"
if (-not [string]::IsNullOrWhiteSpace($existingJson)) {
  foreach ($m in ($existingJson | ConvertFrom-Json)) { $milestones[$m.title] = [int]$m.number }
}
foreach ($title in ($issues | Select-Object -ExpandProperty Milestone -Unique)) {
  [void](Ensure-Milestone -Title $title -Existing $milestones)
}

Write-Host "Ensuring labels..."
$known = @{}
foreach ($l in $labels) { $known[$l.Name] = $true; Ensure-Label -Name $l.Name -Color $l.Color -Description $l.Description }
foreach ($l in ($issues | ForEach-Object { $_.Labels } | Select-Object -Unique)) {
  if (-not $known.ContainsKey($l) -and $l -notin @("bug", "enhancement", "documentation")) {
    Write-Warning "label '$l' is not in the script's list; gh will refuse it unless it already exists"
  }
}

Write-Host "Loading existing issues..."
$existing = Get-AllIssues
$numbers = @{}

Write-Host "Issues..."
foreach ($i in ($issues | Where-Object { -not $_.Tracking } | Sort-Object File)) {
  Publish-Issue -Issue $i -Body $i.Body -Milestones $milestones -Existing $existing -Numbers $numbers
}

Write-Host "Tracking issues..."
$existing = if ($DryRun) { $existing } else { Get-AllIssues }
foreach ($i in ($issues | Where-Object { $_.Tracking } | Sort-Object File)) {
  $body = Expand-Children -Issue $i -All $issues -Numbers $numbers -Existing $existing
  Publish-Issue -Issue $i -Body $body -Milestones $milestones -Existing $existing -Numbers $numbers
}

Write-Host "Done."
