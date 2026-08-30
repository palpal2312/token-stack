param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\plans\reports\orchestrate-260825-sprint02-close\controller-failover.json')
)

$ErrorActionPreference = 'Stop'
$watchdog = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'controller-failover.ps1')).Path
$sourceConfig = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ConfigPath) -Raw | ConvertFrom-Json
$suffix = [guid]::NewGuid().ToString('N')
$sourceConfig.runId = "controller-failover-drill-$suffix"
$sourceConfig.stateFileName = "controller-failover-drill-$suffix.json"
$sourceConfig.incidentLogName = "controller-failover-drill-$suffix.log"
$tempConfig = Join-Path ([IO.Path]::GetTempPath()) "controller-failover-drill-$suffix.json"
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($tempConfig, ($sourceConfig | ConvertTo-Json -Depth 10), $utf8NoBom)

$stateDir = Join-Path $env:LOCALAPPDATA 'NEWSOS'
$statePath = Join-Path $stateDir $sourceConfig.stateFileName
$incidentPath = Join-Path $stateDir $sourceConfig.incidentLogName
$checks = [Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ Check = $Name; Passed = $Passed; Detail = $Detail })
  if (-not $Passed) { throw "FAIL $Name - $Detail" }
}

function Invoke-Watchdog([string[]]$CommandArgs) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watchdog -ConfigPath $tempConfig @CommandArgs 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n") }
}

function Save-TestState($State) {
  [IO.File]::WriteAllText($statePath, ($State | ConvertTo-Json -Depth 10), $utf8NoBom)
}

try {
  $result = Invoke-Watchdog @('-Mode', 'Heartbeat', '-Owner', $sourceConfig.master.id, '-Terminal', $sourceConfig.master.terminal)
  Add-Check 'owner-heartbeat' ($result.ExitCode -eq 0) $result.Output

  $result = Invoke-Watchdog @('-Mode', 'Heartbeat', '-Owner', 'foreign-owner', '-Terminal', 'term_00000000-0000-0000-0000-000000000000')
  Add-Check 'foreign-heartbeat-refused' ($result.ExitCode -ne 0) 'foreign identity cannot refresh or rewrite the lease'

  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $state.heartbeatAt = [DateTime]::UtcNow.AddHours(-1).ToString('o')
  Save-TestState $state
  $result = Invoke-Watchdog @('-Mode', 'Claim', '-Owner', 'not-allowlisted', '-Terminal', 'term_00000000-0000-0000-0000-000000000000', '-Generation', ([string]$state.generation))
  Add-Check 'stale-arbitrary-claim-refused' ($result.ExitCode -ne 0) 'staleness does not authorize an undispatched claimant'

  $successor = @($sourceConfig.successors | Sort-Object priority)[0]
  $state.status = 'takeover_dispatched'
  $state.takeoverOwner = $successor.id
  $state.takeoverTerminal = $successor.terminal
  $state.takeoverDispatchedAt = [DateTime]::UtcNow.ToString('o')
  $state.generation = 7
  Save-TestState $state

  $result = Invoke-Watchdog @('-Mode', 'Claim', '-Owner', $successor.id, '-Terminal', $successor.terminal, '-Generation', '6')
  Add-Check 'stale-generation-claim-refused' ($result.ExitCode -ne 0) 'old takeover prompt cannot claim a newer lease generation'

  $result = Invoke-Watchdog @('-Mode', 'Claim', '-Owner', $successor.id, '-Terminal', $successor.terminal, '-Generation', '7')
  Add-Check 'authorized-claim' ($result.ExitCode -eq 0) $result.Output
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  Add-Check 'claim-bumps-generation' ($state.generation -eq 8 -and $state.owner -eq $successor.id -and $state.status -eq 'active') 'authorized successor owns generation 8'

  $result = Invoke-Watchdog @('-Mode', 'Release', '-Owner', 'foreign-owner', '-Generation', '8')
  Add-Check 'foreign-release-refused' ($result.ExitCode -ne 0) 'only the active owner may release'
  $result = Invoke-Watchdog @('-Mode', 'Release', '-Owner', $successor.id, '-Generation', '8')
  Add-Check 'authorized-release' ($result.ExitCode -eq 0) $result.Output

  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $state.status = 'takeover_dispatched'
  $state.owner = $successor.id
  $state.terminal = $successor.terminal
  $state.generation = 9
  $state.takeoverOwner = 'planned-fresh-master'
  $state.takeoverTerminal = 'term_planned_fresh_master'
  $state.takeoverDispatchedAt = [DateTime]::UtcNow.ToString('o')
  $state | Add-Member -NotePropertyName takeoverReason -NotePropertyValue 'planned' -Force
  Save-TestState $state
  $result = Invoke-Watchdog @('-Mode', 'Claim', '-Owner', 'planned-fresh-master', '-Terminal', 'term_planned_fresh_master', '-Generation', '9')
  Add-Check 'planned-fresh-terminal-claim' ($result.ExitCode -eq 0) $result.Output
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  Add-Check 'planned-claim-bumps-generation' ($state.generation -eq 10 -and $state.owner -eq 'planned-fresh-master' -and $state.status -eq 'active') 'planned target owns generation 10'
  $result = Invoke-Watchdog @('-Mode', 'Release', '-Owner', 'planned-fresh-master', '-Generation', '10')
  Add-Check 'planned-owner-release' ($result.ExitCode -eq 0) $result.Output

  $scriptText = Get-Content -LiteralPath $watchdog -Raw
  $persistMarker = $scriptText.IndexOf('# Authorize and persist before sending.')
  $saveAfterMarker = $scriptText.IndexOf('Save-State $state', $persistMarker)
  $sendAfterMarker = $scriptText.IndexOf("Invoke-OrcaJson @('terminal', 'send'", $persistMarker)
  Add-Check 'persist-before-send-order' ($persistMarker -ge 0 -and $saveAfterMarker -gt $persistMarker -and $sendAfterMarker -gt $saveAfterMarker) 'authorization state is persisted before terminal send'

  $plannedMarker = $scriptText.IndexOf('# Persist planned authorization before sending.')
  $plannedSave = $scriptText.IndexOf('Save-State $state', $plannedMarker)
  $plannedSend = $scriptText.IndexOf("Invoke-OrcaJson @('terminal', 'send'", $plannedMarker)
  Add-Check 'planned-transfer-persist-before-send' ($plannedMarker -ge 0 -and $plannedSave -gt $plannedMarker -and $plannedSend -gt $plannedSave) 'planned target authorization is persisted before terminal send'

  $generationMarker = $scriptText.IndexOf('TAKEOVER_ABANDONED')
  $selectionMarker = $scriptText.IndexOf('$successor = $null', $generationMarker)
  Add-Check 'new-generation-before-next-successor' ($generationMarker -ge 0 -and $selectionMarker -gt $generationMarker) 'failed pending takeover advances generation before selecting another successor'

  $task = Get-ScheduledTask -TaskName 'NEWSOS-Controller-Failover' -ErrorAction Stop
  Add-Check 'scheduled-task-battery-policy' (-not $task.Settings.DisallowStartIfOnBatteries -and -not $task.Settings.StopIfGoingOnBatteries) 'watchdog remains enabled on battery'

  $checks | Format-Table -AutoSize
  Write-Output "DRILL: GO ($($checks.Count)/$($checks.Count))"
} finally {
  foreach ($path in @($tempConfig, $statePath, $incidentPath)) {
    if (Test-Path -LiteralPath $path) {
      $resolved = [IO.Path]::GetFullPath($path)
      $allowedTemp = $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)
      $allowedState = $resolved.StartsWith([IO.Path]::GetFullPath($stateDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('controller-failover-drill-')
      if (-not $allowedTemp -and -not $allowedState) { throw "Refusing cleanup outside drill paths: $resolved" }
      Remove-Item -LiteralPath $resolved -Force
    }
  }
}
