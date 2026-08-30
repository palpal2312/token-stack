param(
  [ValidateSet('Preflight', 'Snapshot', 'CloseGate')]
  [string]$Mode = 'Preflight',
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,
  [switch]$Offline,
  [string]$StatePath,
  [string]$TaskListPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$controllerScript = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'scripts\controller-failover.ps1')).Path
$checks = [Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail })
}

function Read-JsonFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Add-Check $Label $false "missing: $Path"
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Add-Check $Label $false "invalid JSON: $Path"
    return $null
  }
}

function Resolve-Orca([object]$Config) {
  if ($Config.orcaExe -and (Test-Path -LiteralPath $Config.orcaExe)) {
    return (Resolve-Path -LiteralPath $Config.orcaExe).Path
  }
  $command = Get-Command orca -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Invoke-OrcaJson([string]$OrcaExe, [string[]]$CommandArgs) {
  $raw = & $OrcaExe @CommandArgs --json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "orca command failed: $($CommandArgs -join ' ')" }
  return ($raw -join "`n") | ConvertFrom-Json
}

function Get-ControllerState([string]$ResolvedConfig) {
  if ($Offline) {
    if (-not $StatePath) {
      Add-Check 'controller-state' $false 'offline mode requires -StatePath'
      return $null
    }
    return Read-JsonFile $StatePath 'controller-state'
  }
  try {
    $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controllerScript -Mode Status -ConfigPath $ResolvedConfig
    if ($LASTEXITCODE -ne 0) { throw "controller status exited $LASTEXITCODE" }
    return ($raw -join "`n") | ConvertFrom-Json
  } catch {
    Add-Check 'controller-state' $false $_.Exception.Message
    return $null
  }
}

function Get-Tasks([object]$Manifest, [string]$OrcaExe) {
  if ($TaskListPath) {
    $taskPayload = Read-JsonFile $TaskListPath 'task-list'
    if (-not $taskPayload) { return $null }
    if ($taskPayload.result -and $taskPayload.result.tasks) { return @($taskPayload.result.tasks) }
    if ($taskPayload.tasks) { return @($taskPayload.tasks) }
    return @($taskPayload)
  }
  if ($Offline -or -not $Manifest -or -not $Manifest.run_id -or -not $OrcaExe) { return $null }
  try {
    $payload = Invoke-OrcaJson $OrcaExe @('orchestration', 'task-list', '--run', [string]$Manifest.run_id)
    return @($payload.result.tasks)
  } catch {
    Add-Check 'task-list' $false $_.Exception.Message
    return $null
  }
}

function Test-Superseded([object]$Task) {
  $resultText = [string]$Task.result
  return $resultText -match '(?i)superseded|replaced_by|replaced by'
}

function Get-LaneNumber([object]$Task) {
  $text = "{0} {1}" -f [string]$Task.task_title, [string]$Task.display_name
  $match = [regex]::Match($text, '(?i)-L([1-3])(?:-|\b)')
  if ($match.Success) { return [int]$match.Groups[1].Value }
  return 0
}

function Get-LaneSummary([object[]]$Tasks) {
  $summaries = @()
  foreach ($lane in 1..3) {
    $laneTasks = @($Tasks | Where-Object { (Get-LaneNumber $_) -eq $lane -and -not (Test-Superseded $_) })
    $done = @($laneTasks | Where-Object { $_.status -eq 'completed' }).Count
    $active = @($laneTasks | Where-Object { $_.status -in @('pending', 'ready', 'dispatched') }).Count
    $blocked = @($laneTasks | Where-Object { $_.status -in @('blocked', 'failed') }).Count
    $summaries += [pscustomobject]@{
      lane = $lane
      done = $done
      total = $laneTasks.Count
      active = $active
      blocked = $blocked
    }
  }
  return $summaries
}

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Config not found: $ConfigPath" }
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Read-JsonFile $resolvedConfig 'config'
if (-not $config) { throw 'Cannot continue without valid controller config' }
$runDir = Split-Path -Parent $resolvedConfig
$manifestPath = Join-Path $runDir 'run-manifest.json'
$manifest = Read-JsonFile $manifestPath 'run-manifest'
$state = Get-ControllerState $resolvedConfig
$orcaExe = Resolve-Orca $config

$handoffExists = $config.handoffPath -and (Test-Path -LiteralPath $config.handoffPath)
Add-Check 'handoff' ([bool]$handoffExists) ([string]$config.handoffPath)
Add-Check 'master-memory' (Test-Path -LiteralPath (Join-Path $projectRoot 'docs\newsos-master-memory.md')) 'docs/newsos-master-memory.md'
Add-Check 'orchestration-runbook' (Test-Path -LiteralPath (Join-Path $projectRoot 'docs\orchestration-runbook.md')) 'docs/orchestration-runbook.md'

$successors = @($config.successors)
$uniqueSuccessors = @($successors.id | Sort-Object -Unique).Count -eq $successors.Count -and @($successors.terminal | Sort-Object -Unique).Count -eq $successors.Count
Add-Check 'successor-allowlist' ($successors.Count -gt 0 -and $uniqueSuccessors) "$($successors.Count) configured successors"

if ($Offline) {
  Add-Check 'orca-runtime' $true 'offline fixture mode; live probe skipped'
} elseif ($orcaExe) {
  try {
    $null = Invoke-OrcaJson $orcaExe @('status')
    Add-Check 'orca-runtime' $true $orcaExe
  } catch {
    Add-Check 'orca-runtime' $false $_.Exception.Message
  }
} else {
  Add-Check 'orca-runtime' $false 'orca executable not found'
}

if ($state) {
  Add-Check 'controller-state' ($state.status -in @('active', 'takeover_dispatched', 'released')) "status=$($state.status) owner=$($state.owner) generation=$($state.generation)"
}

if ($Mode -eq 'Preflight') {
  $failed = @($checks | Where-Object { -not $_.passed }).Count
  $verdict = if ($failed -gt 0) { 'BLOCKED' } elseif ($state.status -eq 'released') { 'CLOSED' } else { 'READY' }
  [pscustomobject]@{
    mode = $Mode
    runId = $config.runId
    verdict = $verdict
    configPath = $resolvedConfig
    manifestPath = $manifestPath
    controller = $state
    checks = $checks
  } | ConvertTo-Json -Depth 10
  if ($failed -gt 0) { exit 2 }
  exit 0
}

$tasks = Get-Tasks $manifest $orcaExe
if ($tasks) {
  Add-Check 'task-list' $true "$($tasks.Count) tasks"
} else {
  Add-Check 'task-list' $false 'task list unavailable'
  $tasks = @()
}
$lanes = Get-LaneSummary $tasks
$totalDone = ($lanes | Measure-Object -Property done -Sum).Sum
$totalTasks = ($lanes | Measure-Object -Property total -Sum).Sum
$compact = (($lanes | ForEach-Object { "Lane $($_.lane): $($_.done)/$($_.total)" }) -join ' | ') + " || Total: $totalDone/$totalTasks"

if ($Mode -eq 'Snapshot') {
  $failed = @($checks | Where-Object { -not $_.passed }).Count
  [pscustomobject]@{
    mode = $Mode
    runId = if ($manifest) { $manifest.run_id } else { $config.runId }
    verdict = if ($failed -eq 0) { 'OBSERVED' } else { 'DEGRADED' }
    compact = $compact
    lanes = $lanes
    controller = $state
    manifestStatus = if ($manifest) { $manifest.status } else { $null }
    phase21 = if ($manifest) { $manifest.phase_21 } else { $null }
    checks = $checks
  } | ConvertTo-Json -Depth 10
  if ($failed -gt 0) { exit 2 }
  exit 0
}

$arbiterName = if ($manifest -and $manifest.arbiter) { [string]$manifest.arbiter } else { 'arbiter-go.md' }
$arbiterPath = Join-Path $runDir $arbiterName
$arbiterGo = $false
if (Test-Path -LiteralPath $arbiterPath) {
  $arbiterText = Get-Content -LiteralPath $arbiterPath -Raw -Encoding UTF8
  $arbiterGo = $arbiterText -match '(?im)^.*\bGO\b.*$' -and $arbiterText -notmatch '(?im)^\s*\*\*?NO-GO\*\*?\s+for\s+Sprint'
}
Add-Check 'manifest-closed-go' ($manifest -and $manifest.status -eq 'closed_go' -and $manifest.verdict -eq 'GO') "status=$($manifest.status) verdict=$($manifest.verdict)"
Add-Check 'phase21-blocked' ($manifest -and $manifest.phase_21 -eq 'blocked') "phase_21=$($manifest.phase_21)"
Add-Check 'arbiter-go' $arbiterGo $arbiterPath
$leaseCloseState = $state -and $state.status -in @('active', 'released')
Add-Check 'lease-close-state' $leaseCloseState "status=$($state.status)"

$activeTasks = @($tasks | Where-Object { $_.status -in @('pending', 'ready', 'dispatched') -and -not (Test-Superseded $_) })
$unresolvedTasks = @($tasks | Where-Object { $_.status -in @('blocked', 'failed') -and -not (Test-Superseded $_) })
Add-Check 'no-active-tasks' ($activeTasks.Count -eq 0) "$($activeTasks.Count) active"
Add-Check 'no-unresolved-tasks' ($unresolvedTasks.Count -eq 0) "$($unresolvedTasks.Count) unresolved"

$receiptFiles = @(Get-ChildItem -LiteralPath $runDir -Recurse -File -Filter '*.md' -ErrorAction SilentlyContinue)
$markerCount = 0
foreach ($receiptFile in $receiptFiles) {
  $markerCount += @(Select-String -LiteralPath $receiptFile.FullName -Pattern 'JOB_DONE(?:\s*:|\s+)' -Encoding UTF8 -ErrorAction SilentlyContinue).Count
}
Add-Check 'completion-markers' ($markerCount -gt 0) "$markerCount JOB_DONE markers under run directory"

if (-not $Offline -and $state.status -eq 'released') {
  $scheduled = Get-ScheduledTask -TaskName 'NEWSOS-Controller-Failover' -ErrorAction SilentlyContinue
  if ($scheduled) {
    Add-Check 'run-detector-disabled' ($scheduled.State -eq 'Disabled') "state=$($scheduled.State)"
  } else {
    Add-Check 'run-detector-disabled' $true 'scheduled task absent'
  }
}

$failed = @($checks | Where-Object { -not $_.passed }).Count
$closeVerdict = if ($failed -gt 0) { 'NO_GO' } elseif ($state.status -eq 'released') { 'GO' } else { 'READY_TO_RELEASE' }
[pscustomobject]@{
  mode = $Mode
  runId = if ($manifest) { $manifest.run_id } else { $config.runId }
  verdict = $closeVerdict
  compact = $compact
  lanes = $lanes
  checks = $checks
} | ConvertTo-Json -Depth 10
if ($failed -gt 0) { exit 2 }
