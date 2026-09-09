param(
  [string]$Repo = "uhtred1986-lab/trading-card-management"
)

$ErrorActionPreference = "Stop"

function Assert-GhReady {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    throw "GitHub CLI (gh) is not installed. Install it first: https://cli.github.com/"
  }

  gh auth status 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "You are not authenticated. Run: gh auth login"
  }
}

function Get-AllIssues {
  $json = gh issue list --repo $Repo --state all --limit 500 --json number,title
  if ([string]::IsNullOrWhiteSpace($json)) { return @() }
  return $json | ConvertFrom-Json
}

function Ensure-Milestone {
  param([string]$Title)

  $openJson = gh api "repos/$Repo/milestones?state=all&per_page=100"
  $all = @()
  if (-not [string]::IsNullOrWhiteSpace($openJson)) {
    $all = $openJson | ConvertFrom-Json
  }

  $existing = $all | Where-Object { $_.title -eq $Title } | Select-Object -First 1
  if ($existing) {
    Write-Host "Milestone exists: $Title"
    return [int]$existing.number
  }

  $createdJson = gh api "repos/$Repo/milestones" -f title="$Title" -f state="open"
  $created = $createdJson | ConvertFrom-Json
  Write-Host "Milestone created: $Title"
  return [int]$created.number
}

function Ensure-Label {
  param(
    [string]$Name,
    [string]$Color,
    [string]$Description
  )

  gh label create "$Name" --repo $Repo --color "$Color" --description "$Description" --force 1>$null
  Write-Host "Label ensured: $Name"
}

function New-BacklogIssueIfMissing {
  param(
    [hashtable]$Issue,
    [hashtable]$MilestoneNumbers,
    [array]$ExistingIssues
  )

  $match = $ExistingIssues | Where-Object { $_.title -eq $Issue.Title } | Select-Object -First 1
  if ($match) {
    Write-Host "Issue exists (#$($match.number)): $($Issue.Title)"
    return
  }

  $labelsCsv = ($Issue.Labels -join ",")
  $milestoneNumber = $MilestoneNumbers[$Issue.Milestone]

  $body = @"
Source: $($Issue.Source)

Scope:
$($Issue.Scope)

Acceptance checks:
- npm run typecheck
- npm run lint
- npm test
- Scenario proof: document a concrete arena/game/card flow that demonstrates correct behavior.
"@

  gh issue create --repo $Repo --title "$($Issue.Title)" --body "$body" --label "$labelsCsv" --milestone "$milestoneNumber" 1>$null
  Write-Host "Issue created: $($Issue.Title)"
}

Assert-GhReady

$milestones = @(
  "Arena M1 — Rules correctness and parser coverage",
  "Arena M2 — Gameplay UX/HUD completion",
  "Arena M3 — Battle staging and inspector",
  "Arena M4 — Android client enablement",
  "Arena M5 — Engine capability gaps and advanced mechanics"
)

$labels = @(
  @{ Name = "backlog"; Color = "1D76DB"; Description = "Arena backlog tracking item" },
  @{ Name = "ready-for-agent"; Color = "0E8A16"; Description = "Issue is pickup-ready for a future agent" },
  @{ Name = "needs-owner-ruling"; Color = "B60205"; Description = "Blocked pending owner ruling" },
  @{ Name = "blocked"; Color = "D93F0B"; Description = "Blocked by external dependency or prior task" },
  @{ Name = "area:arena-compiler"; Color = "5319E7"; Description = "Arena compiler/parser work" },
  @{ Name = "area:arena-engine"; Color = "5319E7"; Description = "Arena engine/runtime work" },
  @{ Name = "area:arena-ui"; Color = "5319E7"; Description = "Arena UI and board experience work" },
  @{ Name = "area:arena-contract"; Color = "5319E7"; Description = "Arena snapshot/API contract work" },
  @{ Name = "area:arena-android"; Color = "5319E7"; Description = "Arena Android client work" },
  @{ Name = "area:arena-workbench"; Color = "5319E7"; Description = "Arena rules workbench workflow" },
  @{ Name = "phase:rules-stage2"; Color = "C2E0C6"; Description = "Arena rules stage 2 scope" },
  @{ Name = "phase:hud-workflow"; Color = "C2E0C6"; Description = "Arena HUD/workflow completion scope" },
  @{ Name = "phase:battle-staging"; Color = "C2E0C6"; Description = "Arena battle staging scope" },
  @{ Name = "phase:android-client"; Color = "C2E0C6"; Description = "Arena Android client scope" },
  @{ Name = "phase:capability-gap"; Color = "C2E0C6"; Description = "Arena engine capability-gap scope" }
)

$issues = @(
  @{ Title = "Arena: run clause near-miss audit and fix wrong readings"; Milestone = "Arena M1 — Rules correctness and parser coverage"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-compiler","phase:rules-stage2"); Source = "docs/arena-next-session-prompt.md §4(a)"; Scope = "Systematically audit regex near-misses, prefer unread over wrong read, and land verified fixes with reading diffs." },
  @{ Title = "Arena: implement structural side parsing fix in parseTarget"; Milestone = "Arena M1 — Rules correctness and parser coverage"; Labels = @("backlog","ready-for-agent","bug","area:arena-compiler","phase:rules-stage2"); Source = "docs/arena-side-scope.md"; Scope = "Stop whole-clause possessive side inference; derive side from area phrase match with safe fallback." },
  @{ Title = "Arena: fix OR disjunction handling in parseConditionClause"; Milestone = "Arena M1 — Rules correctness and parser coverage"; Labels = @("backlog","ready-for-agent","bug","area:arena-compiler","phase:rules-stage2"); Source = "docs/arena-next-session-prompt.md §4(c)"; Scope = "Fix green X or yellow Y being parsed as AND across fields." },
  @{ Title = "Arena: implement specified-cost reducer mechanics"; Milestone = "Arena M1 — Rules correctness and parser coverage"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-engine","area:arena-compiler","phase:rules-stage2"); Source = "docs/arena-next-session-prompt.md §4(c), docs/arena-markers-stage-scope.md §2/§4"; Scope = "Make specified-cost reductions affect coloured requirements (not total cost) and integrate with play-cost payment logic." },
  @{ Title = "Arena: implement skill-cost reduction family (orbTotals + scope safety)"; Milestone = "Arena M1 — Rules correctness and parser coverage"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-engine","area:arena-compiler","phase:rules-stage2"); Source = "docs/arena-next-session-prompt.md §4(c), docs/arena-next-stage-spec.md §6.6"; Scope = "Add safe handling for reduce skill cost effects, including scoped application." },
  @{ Title = "Arena: finish HUD spec sections 2.2–2.6"; Milestone = "Arena M2 — Gameplay UX/HUD completion"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-ui","phase:hud-workflow"); Source = "docs/arena-hud-spec.md §2.2–§2.6"; Scope = "Merge last+ask card, normalize ghost/filled actions, hint row cleanup, settings overflow menu, and collapsed empty battle area." },
  @{ Title = "Arena: execute and document manual HUD verification matrix"; Milestone = "Arena M2 — Gameplay UX/HUD completion"; Labels = @("backlog","ready-for-agent","documentation","area:arena-ui","phase:hud-workflow"); Source = "docs/arena-hud-spec.md §4, §6.4"; Scope = "Run by-hand phone checks (both skins), capture outcomes, and record defects as follow-up issues." },
  @{ Title = "Arena: add missing-energy chips to workflow UI"; Milestone = "Arena M2 — Gameplay UX/HUD completion"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-ui","phase:hud-workflow"); Source = "docs/arena-workflow-spec.md §9"; Scope = "Implement missing-energy affordance referenced as outstanding in workflow build notes." },
  @{ Title = "Arena: implement battle counters/combos staged duel band"; Milestone = "Arena M3 — Battle staging and inspector"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-ui","area:arena-contract","phase:battle-staging"); Source = "docs/arena-battle-staging-spec.md §3.1–§3.4"; Scope = "Add battle payload and beats for counters/combos and render dual staging with takeover compatibility." },
  @{ Title = "Arena: implement in-fight card inspector details"; Milestone = "Arena M3 — Battle staging and inspector"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-ui","phase:battle-staging"); Source = "docs/arena-battle-staging-spec.md §3.5"; Scope = "Ensure any battle card can open inspector with combo stats, printed text, and engine reading context." },
  @{ Title = "Arena: add battle staging preference and persistence"; Milestone = "Arena M3 — Battle staging and inspector"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-ui","phase:battle-staging"); Source = "docs/arena-battle-staging-spec.md §3.6"; Scope = "Persist staging mode and ensure safe fallback across sessions/devices." },
  @{ Title = "Arena: implement Android /api/v1 deck endpoints"; Milestone = "Arena M4 — Android client enablement"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-contract","area:arena-android","phase:android-client"); Source = "docs/arena-client-contract.md §5"; Scope = "Build not-yet-implemented deck endpoints needed for Android read-only deck flows." },
  @{ Title = "Arena: implement Android Stage 1 app shell and snapshot polling"; Milestone = "Arena M4 — Android client enablement"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-android","phase:android-client"); Source = "docs/arena-android-spec.md §11"; Scope = "Build initial Android app modules, auth, board shell, and live snapshot consumption." },
  @{ Title = "Arena: implement Android battle playback and animation parity"; Milestone = "Arena M4 — Android client enablement"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-android","phase:android-client"); Source = "docs/arena-android-spec.md §5/§6"; Scope = "Add beat playback and board animation behavior aligned with web semantics and contract." },
  @{ Title = "Arena: implement move replacement choice architecture (9-10-2/9-10-3)"; Milestone = "Arena M5 — Engine capability gaps and advanced mechanics"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-engine","area:arena-compiler","phase:capability-gap"); Source = "docs/arena-move-replacement-scope.md"; Scope = "Add prompt-capable replacement selection path at suspendable call sites while preserving deterministic behavior elsewhere." },
  @{ Title = "Arena: implement Empower up to Y player choice"; Milestone = "Arena M5 — Engine capability gaps and advanced mechanics"; Labels = @("backlog","ready-for-agent","bug","area:arena-engine","phase:capability-gap"); Source = "docs/arena-markers-stage-scope.md §2/§4"; Scope = "Replace auto-carry with explicit player choice for marker inheritance up to Y." },
  @{ Title = "Arena: add Empower inheritance transfer beat and board animation"; Milestone = "Arena M5 — Engine capability gaps and advanced mechanics"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-contract","area:arena-ui","phase:capability-gap"); Source = "docs/arena-markers-stage-scope.md §3/§4"; Scope = "Introduce beat naming source+target card for marker transfer and animate transfer on board." },
  @{ Title = "Arena: support keyword parse for [Empower XY/ZY]"; Milestone = "Arena M5 — Engine capability gaps and advanced mechanics"; Labels = @("backlog","ready-for-agent","enhancement","area:arena-compiler","phase:capability-gap"); Source = "docs/arena-markers-stage-scope.md §2"; Scope = "Extend keyword parser for two-colour Empower syntax; keep low priority until cards require it." }
)

Write-Host "Ensuring milestones..."
$milestoneNumbers = @{}
foreach ($m in $milestones) {
  $milestoneNumbers[$m] = Ensure-Milestone -Title $m
}

Write-Host "Ensuring labels..."
foreach ($l in $labels) {
  Ensure-Label -Name $l.Name -Color $l.Color -Description $l.Description
}

Write-Host "Loading existing issues..."
$existingIssues = Get-AllIssues

Write-Host "Creating backlog issues (if missing)..."
foreach ($i in $issues) {
  New-BacklogIssueIfMissing -Issue $i -MilestoneNumbers $milestoneNumbers -ExistingIssues $existingIssues
}

Write-Host "Done."
