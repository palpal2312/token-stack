$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$stateScript = Join-Path $scriptRoot 'newos-master-state.ps1'
$receiptScript = Join-Path $scriptRoot 'newos-receipt-verify.ps1'
$workerScript = Join-Path $scriptRoot 'newos-worker-preflight.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("newos-master-tests-" + [guid]::NewGuid().ToString('N'))
$runDir = Join-Path $fixtureRoot 'plans\reports\orchestrate-fixture'
$handoffDir = Join-Path $fixtureRoot 'plans\handoffs'
$checks = [Collections.Generic.List[object]]::new()
$utf8NoBom = [Text.UTF8Encoding]::new($false)

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ check = $Name; passed = $Passed; detail = $Detail })
  if (-not $Passed) { throw "FAIL $Name - $Detail" }
}

function Write-Utf8([string]$Path, [string]$Content) {
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-JsonScript([string]$Path, [string[]]$Arguments, [int]$ExpectedExit = 0) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Path @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($exitCode -ne $ExpectedExit) {
    throw "Unexpected exit $exitCode from $Path; expected $ExpectedExit; output=$($raw -join ' ')"
  }
  return ($raw -join "`n") | ConvertFrom-Json
}

try {
  New-Item -ItemType Directory -Path $runDir, $handoffDir -Force | Out-Null
  $handoffPath = Join-Path $handoffDir 'controller-succession-fixture.md'
  Write-Utf8 $handoffPath "# Fixture handoff`n"

  $configPath = Join-Path $runDir 'controller-failover.json'
  $config = [ordered]@{
    schemaVersion = 1
    runId = 'orchestrate-fixture'
    workspace = $fixtureRoot
    handoffPath = $handoffPath
    stateFileName = 'fixture-state.json'
    incidentLogName = 'fixture-incidents.log'
    orcaExe = 'C:\missing\orca.exe'
    staleAfterSeconds = 900
    dispatchCooldownSeconds = 600
    master = @{ id = 'fixture-master'; terminal = 'term_fixture_master' }
    successors = @(@{ priority = 1; id = 'fixture-standby'; terminal = 'term_fixture_standby' })
  }
  Write-Utf8 $configPath ($config | ConvertTo-Json -Depth 10)

  $manifest = [ordered]@{
    run_id = 'run_fixture'
    status = 'closed_go'
    verdict = 'GO'
    phase_20 = 'open'
    phase_21 = 'blocked'
    arbiter = 'arbiter-go.md'
  }
  Write-Utf8 (Join-Path $runDir 'run-manifest.json') ($manifest | ConvertTo-Json -Depth 6)
  Write-Utf8 (Join-Path $runDir 'arbiter-go.md') "# Arbiter`n`nVerdict: GO for sprint close.`n"

  $statePath = Join-Path $fixtureRoot 'controller-state.json'
  $state = [ordered]@{
    schemaVersion = 1
    runId = 'orchestrate-fixture'
    generation = 3
    status = 'released'
    owner = 'fixture-master'
    terminal = 'term_fixture_master'
    heartbeatAt = [DateTime]::UtcNow.ToString('o')
  }
  Write-Utf8 $statePath ($state | ConvertTo-Json -Depth 6)

  $taskPath = Join-Path $fixtureRoot 'tasks.json'
  $taskPayload = @{ result = @{ tasks = @(
    @{ task_title = 'S05-L1-001'; display_name = 'Lane 1'; status = 'completed'; result = 'ok' },
    @{ task_title = 'S05-L2-001'; display_name = 'Lane 2'; status = 'completed'; result = 'ok' },
    @{ task_title = 'S05-L3-001'; display_name = 'Lane 3'; status = 'completed'; result = 'ok' },
    @{ task_title = 'S05-L1-primary'; display_name = 'Lane 1 primary'; status = 'blocked'; result = 'replaced_by fallback' }
  ) } }
  Write-Utf8 $taskPath ($taskPayload | ConvertTo-Json -Depth 8)

  $artifactPath = Join-Path $fixtureRoot 'artifact.txt'
  Write-Utf8 $artifactPath 'stable artifact'
  $hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $receiptPath = Join-Path $runDir 'lane-receipt.md'
  Write-Utf8 $receiptPath "# Receipt`n`n$hash  artifact.txt`n`nJOB_DONE: S05-L1-001`n"

  $baseArgs = @('-ConfigPath', $configPath, '-Offline', '-StatePath', $statePath, '-TaskListPath', $taskPath)
  $preflight = Invoke-JsonScript $stateScript (@('-Mode', 'Preflight') + $baseArgs)
  Add-Check 'offline-preflight-closed' ($preflight.verdict -eq 'CLOSED') $preflight.verdict

  $snapshot = Invoke-JsonScript $stateScript (@('-Mode', 'Snapshot') + $baseArgs)
  Add-Check 'snapshot-effective-tasks' ($snapshot.verdict -eq 'OBSERVED' -and $snapshot.compact -match 'Total: 3/3') $snapshot.compact

  $closeGate = Invoke-JsonScript $stateScript (@('-Mode', 'CloseGate') + $baseArgs)
  Add-Check 'offline-close-gate' ($closeGate.verdict -eq 'GO') $closeGate.verdict

  $receiptPass = Invoke-JsonScript $receiptScript @('-ReceiptPath', $receiptPath, '-ProjectRoot', $fixtureRoot)
  Add-Check 'receipt-current-bytes-pass' ($receiptPass.verdict -eq 'PASS') $receiptPass.verdict

  Write-Utf8 $artifactPath 'drifted artifact'
  $receiptFail = Invoke-JsonScript $receiptScript @('-ReceiptPath', $receiptPath, '-ProjectRoot', $fixtureRoot) 2
  Add-Check 'receipt-drift-fails' ($receiptFail.verdict -eq 'FAIL') $receiptFail.verdict

  $workerPass = Invoke-JsonScript $workerScript @('-Command', 'powershell.exe')
  Add-Check 'worker-command-resolves' ($workerPass.verdict -eq 'PASS') $workerPass.verdict

  $workerFail = Invoke-JsonScript $workerScript @('-Command', 'newsos-command-does-not-exist') 2
  Add-Check 'missing-worker-command-fails' ($workerFail.verdict -eq 'FAIL') $workerFail.verdict

  $checks | Format-Table -AutoSize
  Write-Output "NEWOS_MASTER_TESTS: GO ($($checks.Count)/$($checks.Count))"
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedFixture) -notlike 'newos-master-tests-*') {
      throw "Refusing cleanup outside isolated test fixture: $resolvedFixture"
    }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
  }
}

