param(
  [switch]$Dispatch,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$backlogPath = 'C:\Users\ADMIN\Documents\Agent OS\plans\260804-0518-sen-news-os-implementation\sprint-01-lane-backlog.json'
$stateDir = Join-Path $env:LOCALAPPDATA 'NEWSOS'
$statePath = Join-Path $stateDir 'sprint-01-watchdog-state.json'
$masterLogPath = Join-Path $stateDir 'sprint-01-master-progress.log'
$orcaExe = 'C:\Users\ADMIN\AppData\Local\Programs\orca\resources\bin\orca.exe'
if (-not (Test-Path -LiteralPath $orcaExe)) { $orcaExe = (Get-Command orca -ErrorAction Stop).Source
}
$mutex = [Threading.Mutex]::new($false, 'Global\NEWSOS-Sprint01-Watchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {

function Invoke-OrcaJson([string[]]$CommandArgs) {
  $raw = & $orcaExe @CommandArgs --json 2>$null
  if ($LASTEXITCODE -ne 0) {
    if ($CommandArgs.Count -ge 2 -and $CommandArgs[0] -eq 'terminal' -and $CommandArgs[1] -eq 'wait') {
      return [pscustomobject]@{ result = [pscustomobject]@{ wait = [pscustomobject]@{ satisfied = $false } } }
    }
    throw "orca command failed: $($CommandArgs -join ' ')"
  }
  return ($raw -join "`n") | ConvertFrom-Json
}

$backlog = Get-Content -LiteralPath $backlogPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$state = if (Test-Path -LiteralPath $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ lanes = @() } }

$rows = @()
foreach ($lane in $backlog.lanes) {
  $terms = Invoke-OrcaJson @('terminal','list','--worktree',"path:$($lane.worktree)")
  $laneState = @($state.lanes | Where-Object { $_.lane -eq $lane.lane }) | Select-Object -First 1
  if (-not $laneState) { $laneState = [pscustomobject]@{ lane = $lane.lane; nextIndex = 0; completedCount = 0; activeJob = $null; lastAction = $null }; $state.lanes += $laneState }
  if ($null -eq $laneState.PSObject.Properties['completedCount']) { $laneState | Add-Member -NotePropertyName completedCount -NotePropertyValue 0 }
  $preferred = switch ([int]$lane.lane) {
    1 { @('term_653759e1-76e5-4214-8bc6-dec27490da1c','term_607dcf9b-16e3-472f-b3d1-e1b98a7b7f1e'); break }
    2 { @('term_a314d627-e6d9-4086-9ad9-283b89031516'); break }
    3 { @('term_9f09902d-e62b-473d-afc9-9347727c261f'); break }
  }
  $terminal = @($terms.result.terminals | Where-Object { $preferred -contains $_.handle -and $_.connected -and $_.writable } | Sort-Object { [array]::IndexOf($preferred, $_.handle) }) | Select-Object -First 1
  $nextIndex = [int]$laneState.nextIndex
  if ($terminal -and $laneState.activeJob) {
    try {
      $tail = Invoke-OrcaJson @('terminal','read','--terminal',$terminal.handle,'--limit','40')
      $marker = "JOB_DONE: $($laneState.activeJob)"
      $closedMarker = "EXHAUSTED_CLOSED: $($laneState.activeJob)"
      $tailText = (@($tail.result.terminal.tail) -join "`n")
      if ($tailText.Contains($marker) -or $tailText.Contains($closedMarker)) {
        $laneState.lastAction = "completed $($laneState.activeJob)"
        $laneState.activeJob = $null
        $laneState.completedCount = [int]$laneState.completedCount + 1
        if ($tailText.Contains($closedMarker)) { $laneState.lastAction = "closed $($laneState.activeJob)"; $lane.refill_enabled = $false }
      }
    } catch { }
  }
  $job = if ($nextIndex -lt @($lane.jobs).Count) { $lane.jobs[$nextIndex] } else { $null }
  $idle = $false
  if ($terminal) {
    try {
      $wait = Invoke-OrcaJson @('terminal','wait','--terminal',$terminal.handle,'--for','tui-idle','--timeout-ms','1000')
      $idle = [bool]$wait.result.wait.satisfied
    } catch {
      $idle = $false
      $laneState.lastAction = "probe failed: $($_.Exception.Message)"
    }
  }
  $action = 'none'
  $refill = (-not $job -and $lane.refill_enabled -and $lane.refill_prompt -and -not $laneState.activeJob)
  if ($Dispatch -and $terminal -and $idle -and ($job -or $refill) -and -not $laneState.activeJob) {
    if ($refill) {
      if ($null -eq $laneState.PSObject.Properties['refillGeneration']) { $laneState | Add-Member -NotePropertyName refillGeneration -NotePropertyValue 0 }
      $refillId = "REFILL-L$($lane.lane)-$([int]$laneState.refillGeneration + 1)"
      $text = "${refillId}: $($lane.refill_prompt) End the useful work with the exact marker JOB_DONE: $refillId, or EXHAUSTED_CLOSED: $refillId if no valuable work remains."
      $laneState.refillGeneration = [int]$laneState.refillGeneration + 1
      $laneState.lastAction = "dispatched $refillId"
      $laneState.activeJob = $refillId
      $laneState.completedCount = [int]$laneState.completedCount
      $action = "dispatched $refillId"
    } else {
      $text = "$($job.id): $($job.prompt) End the job with the exact marker JOB_DONE: $($job.id)."
      $laneState.nextIndex = $nextIndex + 1
      $laneState.activeJob = $job.id
      $laneState.lastAction = "dispatched $($job.id)"
      $action = "dispatched $($job.id)"
    }
    Invoke-OrcaJson @('terminal','send','--terminal',$terminal.handle,'--text',$text,'--enter') | Out-Null
  }
  $laneStatus = if ($laneState.activeJob) { 'RUNNING' } elseif (-not $job -and -not $lane.refill_enabled) { 'EXHAUSTED' } elseif (-not $job) { 'REFILL_READY' } elseif ($terminal -and $idle) { 'READY' } else { 'WAITING' }
  if ($laneStatus -eq 'EXHAUSTED') { $laneState.lastAction = 'REFILL_REQUIRED: run $ak:plan or assign cross-lane support' }
  $rows += [pscustomobject]@{ lane=$lane.lane; status=$laneStatus; done=[int]$laneState.completedCount; total=@($lane.jobs).Count; terminal=if($terminal){$terminal.handle}else{$null}; idle=$idle; nextJob=if($job){$job.id}else{$null}; action=$action }
}

$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding utf8
$summary = (($rows | ForEach-Object { "Lane $($_.lane): $($_.done)/$($_.total)" }) -join ' | ') + " || Tổng: $((($rows | Measure-Object -Property done -Sum).Sum))/$(($rows | Measure-Object -Property total -Sum).Sum)"
Add-Content -LiteralPath $masterLogPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $summary) -Encoding utf8
foreach ($row in $rows | Where-Object status -eq 'EXHAUSTED') { Add-Content -LiteralPath $masterLogPath -Value ("{0} REFILL_REQUIRED Lane {1}: run `$ak:plan` or assign cross-lane support" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $row.lane) -Encoding utf8 }
Write-Output $summary
if ($Json) { $rows | ConvertTo-Json -Depth 6 }
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
