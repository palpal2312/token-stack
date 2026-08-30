param(
  [ValidateSet('Locate', 'Status', 'Check', 'Heartbeat', 'Claim', 'Release', 'Preflight', 'Snapshot', 'CloseGate', 'Finalize')]
  [string]$Mode = 'Locate',
  [string]$ConfigPath,
  [string]$Owner,
  [string]$Terminal,
  [int]$Generation = -1
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$controllerScript = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'scripts\controller-failover.ps1')).Path
$stateScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'newos-master-state.ps1')).Path

function Invoke-Controller([string]$Path, [string[]]$CommandArgs) {
  $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controllerScript -ConfigPath $Path @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Controller command failed with exit $LASTEXITCODE"
  }
  return ($raw -join "`n")
}

function Resolve-LatestConfig {
  if ($ConfigPath) {
    return (Resolve-Path -LiteralPath $ConfigPath).Path
  }
  $candidates = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'plans\reports') -Directory -Filter 'orchestrate-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'controller-failover.json' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending
  if (-not $candidates) { throw 'No controller-failover.json exists under plans/reports/orchestrate-*' }

  foreach ($candidate in $candidates) {
    try {
      $status = Invoke-Controller $candidate @('-Mode', 'Status') | ConvertFrom-Json
      if ($status.status -ne 'released') { return (Resolve-Path -LiteralPath $candidate).Path }
    } catch { }
  }
  return (Resolve-Path -LiteralPath @($candidates)[0]).Path
}

$resolvedConfig = Resolve-LatestConfig
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$statusJson = Invoke-Controller $resolvedConfig @('-Mode', 'Status')
$state = $statusJson | ConvertFrom-Json

if ($Mode -eq 'Locate') {
  [pscustomobject]@{
    runId = $config.runId
    configPath = $resolvedConfig
    handoffPath = $config.handoffPath
    memoryPath = (Join-Path $projectRoot 'docs\newsos-master-memory.md')
    runbookPath = (Join-Path $projectRoot 'docs\orchestration-runbook.md')
    stateScript = $stateScript
    receiptVerifier = (Join-Path $PSScriptRoot 'newos-receipt-verify.ps1')
    workerPreflight = (Join-Path $PSScriptRoot 'newos-worker-preflight.ps1')
    takeoverLauncher = (Join-Path $PSScriptRoot 'newos-master-take-over.ps1')
    status = $state.status
    owner = $state.owner
    terminal = $state.terminal
    generation = $state.generation
    heartbeatAt = $state.heartbeatAt
    takeoverOwner = $state.takeoverOwner
    takeoverTerminal = $state.takeoverTerminal
  } | ConvertTo-Json -Depth 5
  exit 0
}

if ($Mode -in @('Preflight', 'Snapshot', 'CloseGate')) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stateScript -Mode $Mode -ConfigPath $resolvedConfig
  exit $LASTEXITCODE
}

if ($Mode -eq 'Finalize') {
  $preRaw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stateScript -Mode CloseGate -ConfigPath $resolvedConfig
  if ($LASTEXITCODE -ne 0) { throw "Close gate failed before release: $($preRaw -join ' ')" }
  $preGate = ($preRaw -join "`n") | ConvertFrom-Json
  if ($preGate.verdict -ne 'READY_TO_RELEASE') {
    throw "Finalize requires READY_TO_RELEASE, got $($preGate.verdict)"
  }

  Invoke-Controller $resolvedConfig @('-Mode', 'Release', '-Owner', $state.owner, '-Generation', ([string]$state.generation)) | Out-Null
  $scheduled = Get-ScheduledTask -TaskName 'NEWSOS-Controller-Failover' -ErrorAction SilentlyContinue
  if ($scheduled -and $scheduled.State -ne 'Disabled') {
    Disable-ScheduledTask -TaskName 'NEWSOS-Controller-Failover' | Out-Null
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stateScript -Mode CloseGate -ConfigPath $resolvedConfig
  exit $LASTEXITCODE
}

if ($Mode -eq 'Status') {
  Write-Output $statusJson
  exit 0
}

if ($Mode -eq 'Check') {
  Invoke-Controller $resolvedConfig @('-Mode', 'Check')
  exit 0
}

if ($Mode -eq 'Claim') {
  if (-not $Owner -or -not $Terminal -or $Generation -lt 0) {
    throw 'Claim requires exact -Owner, -Terminal and -Generation from CONTROLLER_FAILOVER'
  }
  Invoke-Controller $resolvedConfig @('-Mode', 'Claim', '-Owner', $Owner, '-Terminal', $Terminal, '-Generation', ([string]$Generation))
  exit 0
}

if ($Mode -eq 'Heartbeat') {
  Invoke-Controller $resolvedConfig @('-Mode', 'Heartbeat', '-Owner', $state.owner, '-Terminal', $state.terminal)
  exit 0
}

if ($Mode -eq 'Release') {
  Invoke-Controller $resolvedConfig @('-Mode', 'Release', '-Owner', $state.owner, '-Generation', ([string]$state.generation))
  exit 0
}
