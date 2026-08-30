# Advisory removal gate for lane worktrees (1 lane = 1 git worktree;
# see docs/one-lane-one-worktree.md). Read-only: never writes the journal
# or git — it answers "can I remove this lane's worktree?" with an exit code.
#
#   exit 0 = SAFE: the lane is DONE and every evidence path it reported
#            already exists at the repo HEAD; nothing branch-unique is lost.
#   exit 2 = NOT SAFE: prints what is missing (no DONE, or evidence absent).
#
# Examples:
#   .\scripts\lane-worktree-gate.ps1 -Lane s10-readonly-canary      # SAFE
#   .\scripts\lane-worktree-gate.ps1 -Lane s10-independent-arbiter  # NOT SAFE

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Lane,
  [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
  [string]$StateFile
)

$ErrorActionPreference = 'Stop'

if (-not $StateFile) {
  $baseDir = if ($env:AGENTIC_OS_HOME) { $env:AGENTIC_OS_HOME } else { Join-Path $HOME '.agentic-os' }
  $StateFile = Join-Path $baseDir 'orchestration-state.jsonl'
}
if (-not (Test-Path $StateFile)) {
  Write-Host "state journal not found: $StateFile"
  exit 2
}

# (a) The lane's latest lifecycle event must be DONE.
$events = @()
foreach ($line in Get-Content $StateFile) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $event = $line | ConvertFrom-Json
  if ($event.lane -eq $Lane) { $events += $event }
}
if ($events.Count -eq 0) {
  Write-Host "no journal events for lane $Lane - nothing proves it ran; not safe."
  exit 2
}
$last = $events[-1]
if ($last.transition -ne 'DONE') {
  Write-Host "latest event for lane $Lane is $($last.transition), not DONE - not safe."
  exit 2
}

# (b) Every evidence path the lane reported must exist at the repo HEAD.
# Native git prints "fatal: ..." to stderr on a miss, and PowerShell 5.1 turns
# redirected native stderr into error records — relax the error preference for
# the probes and judge by $LASTEXITCODE only.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
git -C $RepoRoot rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  $ErrorActionPreference = $prevEAP
  Write-Host "not a git repo: $RepoRoot"
  exit 2
}
$missing = @()
foreach ($event in $events) {
  if (-not $event.evidencePath) { continue }
  $rel = $event.evidencePath -replace '\\','/'
  git -C $RepoRoot cat-file -e "HEAD:$rel" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { $missing += $event.evidencePath }
}
$ErrorActionPreference = $prevEAP
if ($missing.Count -gt 0) {
  Write-Host "NOT SAFE: lane $Lane evidence missing at repo HEAD:"
  foreach ($m in $missing) { Write-Host "  - $m" }
  Write-Host 'Promote the evidence to master first, then re-run this gate.'
  exit 2
}
Write-Host "SAFE: lane $Lane is DONE and all its evidence exists at repo HEAD; the worktree can be removed."
exit 0
