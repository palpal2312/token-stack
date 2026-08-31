<#
.SYNOPSIS
  Phase 12 staging host onboarding PROBE. READ-ONLY. No writes anywhere.
.DESCRIPTION
  Verifies prereq toolchain + host state for the Phase 12 cutover staging host.
  - No installs, no service changes, no registry/env/firewall/network writes.
  - %LOCALAPPDATA%\NEWSOS is reported but NEVER created.
  - Watchdog scheduled task state is reported but NEVER changed.
  - Always exits 0; each probe prints one [PASS]/[FAIL] summary line.
  Sources: plans/260831-0115-s12-phase12-cutover-gate/plan.md,
           plans/260831-0206-s12-phase12-cutover-pack/runbook.md,
           plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md,
           plans/reports/s12-phase12-readiness-260831.md
#>

[CmdletBinding()]
param(
  # Path to the release clone on this host. Defaults to this checkout's repo root.
  [string]$ClonePath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$expectedCommit = 'b50f519'              # pinned master byte set (runbook preflight / readiness)
$requiredNodeMajor = 24                  # project runtime (matches the owner's verified node build)

function Test-Probe {
  param(
    [string]$Name,
    [scriptblock]$Test,
    [string]$Detail
  )
  try {
    $ok = & $Test
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  } catch {
    $ok = $false
    $mark = 'FAIL'
    $Detail = $Detail + (' [error: {0}]' -f $_.Exception.Message)
  }
  Write-Host ("[{0}] {1}: {2}" -f $mark, $Name, $Detail)
}

Write-Host ('== Phase 12 staging host onboarding PROBE (read-only) — host {0} ==' -f $env:COMPUTERNAME)

# --- 1. Toolchain probe ---
$nodeVer = if (Get-Command node -EA SilentlyContinue) { (node -v 2>$null) } else { $null }
if (-not $nodeVer) { $nodeVer = 'MISSING' }
$nodeMajor = if ($nodeVer -match '^v(\d+)') { [int]$Matches[1] } else { 0 }
Test-Probe 'node' { ($nodeMajor -eq $requiredNodeMajor) } ("node -v = {0} (project pins major {1})" -f $nodeVer, $requiredNodeMajor)

$goVer = if (Get-Command go -EA SilentlyContinue) { (go version 2>$null) } else { $null }
if (-not $goVer) { $goVer = 'MISSING' }
Test-Probe 'go toolchain' { ($goVer -and $goVer -match '^go version') } ("go version = {0}" -f $goVer)

$gitVer = if (Get-Command git -EA SilentlyContinue) { (git --version 2>$null) } else { $null }
if (-not $gitVer) { $gitVer = 'MISSING' }
Test-Probe 'git' { ($gitVer -and $gitVer -match '^git version') } ("git --version = {0}" -f $gitVer)

# --- 2. %LOCALAPPDATA%\NEWSOS ---
$newsos = Join-Path $env:LOCALAPPDATA 'NEWSOS'
$newsosExists = Test-Path -LiteralPath $newsos
$newsosState = if ($newsosExists) { 'EXISTS (OK)' } else { 'MISSING - owner must create' }
Test-Probe 'NEWSOS dir' { $newsosExists } ("{0} : {1}; NOT created by this probe. Owner creates at 1a (probe with throwaway runId)." -f $newsos, $newsosState)

# --- 3. Clone file set ---
$cf = Join-Path $ClonePath 'scripts\controller-failover.ps1'
$inst = Join-Path $ClonePath 'scripts\install-controller-failover-task.ps1'
$fix = Join-Path $ClonePath 'scripts\test-controller-failover.fixture.json'
$files = @{ 'controller-failover.ps1' = $cf; 'install-controller-failover-task.ps1' = $inst; 'test-controller-failover.fixture.json' = $fix }
foreach ($k in $files.Keys) {
  $fileState = if (Test-Path -LiteralPath $files[$k]) { 'PRESENT' } else { 'MISSING' }
  Test-Probe "file: $k" { Test-Path -LiteralPath $files[$k] } ("{0} {1}" -f (Split-Path $files[$k] -Parent), $fileState)
}

# --- 4. Watchdog scheduled task (report-only; must NOT be installed yet) ---
$taskName = 'NEWSOS-Controller-Failover'
$task = $null
try { $task = Get-ScheduledTask -TaskName $taskName } catch { $task = $null }
if ($task) {
  $nextRun = 'n/a'
  try { $nextRun = (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime } catch { $nextRun = 'n/a' }
  Test-Probe "watchdog task $taskName" { $false } ("INSTALLED, State={0} (NextRun={1}) - must NOT be installed on this host; owner runs install-controller-failover-task.ps1 later (ops-prep 1a). Not changed." -f $task.State, $nextRun)
} else {
  Test-Probe "watchdog task $taskName" { $true } "NOT installed (expected). Install stays an owner step per ops-prep 1a."
}

# --- 5. Disk free > 20 GB (on the %LOCALAPPDATA% volume); guarded so the probe
# never throws even when LOCALAPPDATA is absent ---
$drive = $null
try { $drive = (Get-Item -LiteralPath $env:LOCALAPPDATA -EA Stop).PSDrive } catch { $drive = $null }
$freeGB = if ($drive) { [math]::Round($drive.Free / 1GB, 1) } else { 'n/a' }
Test-Probe 'disk free' { ($drive -and $drive.Free -gt 20GB) } ("{0}: {1} GB free (need > 20 GB, 40 GB SSD target per ops-prep 1a)" -f ($(if ($drive) { $drive.Name } else { 'n/a' })), $freeGB)

# --- 6. Release clone at pinned commit + clean worktree (runbook t0 preflight) ---
$head = if (Test-Path -LiteralPath (Join-Path $ClonePath '.git')) { (git -C $ClonePath rev-parse HEAD 2>$null) } else { $null }
$branch = if ($head) { (git -C $ClonePath rev-parse --abbrev-ref HEAD 2>$null) } else { $null }
$headShort = if ($head) { $head.Substring(0, [Math]::Min(7, $head.Length)) } else { 'MISSING' }
if (-not $branch) { $branch = 'n/a' }
Test-Probe 'clone pinned commit' { ($head -and $headShort -eq $expectedCommit) } ("expected {0} / current HEAD {1} (branch {2})" -f $expectedCommit, $headShort, $branch)
$dirtyLines = if ($head) { @(git -C $ClonePath status --porcelain 2>$null).Count } else { -1 }
Test-Probe 'clone clean worktree' { ($dirtyLines -eq 0) } ("git status --porcelain lines = {0} (must be 0 per runbook t0 preflight)" -f $dirtyLines)

# --- 6b. Env var NAMES presence probe (values never read or echoed) ---
foreach ($envName in @('AGENTIC_OS_HOME', 'SEN_DAEMON_ADDR', 'SEN_DAEMON_URL', 'SEN_GO_BUILDER_EXEC_AUTHORITY', 'DATABASE_URL')) {
  $envSet = -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($envName, 'Process'))
  Test-Probe "env: $envName" { $envSet } ($(if ($envSet) { 'present (value not shown)' } else { 'NOT SET - owner step 1a' }))
}

# --- ACTION CHECKLIST (owner, not this script) ---
Write-Host ''
Write-Host '== ACTION CHECKLIST (owner must do on this host; probe does not) =='
Write-Host '1a Env var NAMES to set (values go in local secret store only): AGENTIC_OS_HOME, SEN_DAEMON_ADDR, SEN_DAEMON_URL, SEN_GO_BUILDER_EXEC_AUTHORITY, DATABASE_URL'
Write-Host '1a Create %LOCALAPPDATA%\NEWSOS and confirm state/incident JSON writes (throwaway runId).'
Write-Host '1a Install + enable watchdog: scripts/install-controller-failover-task.ps1 (task NEWSOS-Controller-Failover), after this probe passes.'
Write-Host '1e BACKUP to a SECOND volume/object store: full pre-cutover backup of sen-product.db + community-queue.db; test restore (offline, read-only verify, fail-closed); cadence nightly + pre-flip + post-flip; 7-day retention. Keep backup separate from the code rollback branch.'
Write-Host '1d SLO PROBE placement: one live externally-verifiable probe per SLO on the staging host (Availability: HTTP health /30s, alert on 2 consecutive failures; RPO: age of newest durable write, alert @5 min; RTO: failure-signal to restored-service, alert @15 min; write-verification: post-atomic-flip, new adapter canonical + legacy inert). Metrics to %LOCALAPPDATA%\NEWSOS\s12-metrics; alert thresholds set and ARMED before canary (gate G4).'
Write-Host '1f OWNER-ONLY FLIP rule: only the named owner flips legacy_writer — one manual, supervised, atomic command. No script/CI/scheduled task flips autonomously. Arbiter has read-only state/byte access, no write path to the flag.'
Write-Host ('1g No secrets: redaction scrub on any CI/canary logs; no <env> value blocks; env injected at runtime only.')

# --- End: ALWAYS exit 0 (probe-only; FAIL lines above are owner findings, not a hard stop) ---
Write-Host ''
Write-Host 'Probe complete. Read-only: nothing was installed, created, or changed. Exit 0 by design.'
exit 0