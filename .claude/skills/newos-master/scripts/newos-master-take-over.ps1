param(
  [ValidateSet('Codex', 'Claude', 'Antigravity', 'Kimi', 'Pi', 'Cursor')]
  [string]$AgentProfile = 'Codex',
  [string]$ConfigPath,
  [ValidateRange(10, 60)]
  [int]$ReadyTimeoutSeconds = 45,
  [ValidateRange(10, 120)]
  [int]$ClaimTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$masterWrapper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'newos-master.ps1')).Path
$controllerScript = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'scripts\controller-failover.ps1')).Path

$profiles = @{
  Codex = 'codex --dangerously-bypass-approvals-and-sandbox'
  Claude = 'claude-kimicode --dangerously-skip-permissions'
  Antigravity = 'claude-sub2api-02 --dangerously-skip-permissions'
  Kimi = 'claude-kimicode --dangerously-skip-permissions'
  Pi = 'claude-alibaba-01 --dangerously-skip-permissions'
  Cursor = 'agent --yolo'
}

function Invoke-JsonCommand([string]$Executable, [string[]]$CommandArgs) {
  $raw = & $Executable @CommandArgs 2>$null
  if ($LASTEXITCODE -ne 0) { throw "command failed: $Executable $($CommandArgs -join ' ')" }
  return ($raw -join "`n") | ConvertFrom-Json
}

$locateArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $masterWrapper, '-Mode', 'Locate')
if ($ConfigPath) { $locateArgs += @('-ConfigPath', $ConfigPath) }
$located = Invoke-JsonCommand 'powershell.exe' $locateArgs
if ($located.status -eq 'released') {
  throw "Latest run $($located.runId) is released; refusing to revive a closed sprint. Create a new run first."
}
if ($located.status -ne 'active') {
  throw "Planned transfer requires an active controller lease; current status is $($located.status)"
}

$config = Get-Content -LiteralPath $located.configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$orcaExe = if ($config.orcaExe -and (Test-Path -LiteralPath $config.orcaExe)) {
  (Resolve-Path -LiteralPath $config.orcaExe).Path
} else {
  (Get-Command orca -ErrorAction Stop).Source
}

$targetOwner = "newos-master-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$title = "NEWS OS Master takeover ($AgentProfile)"
$created = Invoke-JsonCommand $orcaExe @('terminal', 'create', '--worktree', "path:$($config.workspace)", '--title', $title, '--command', $profiles[$AgentProfile], '--json')
$targetTerminal = [string]$created.result.terminal.handle
if ([string]::IsNullOrWhiteSpace($targetTerminal)) { throw 'Orca did not return a terminal handle' }

$readyDeadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
$ready = $false
while ([DateTime]::UtcNow -lt $readyDeadline) {
  Start-Sleep -Milliseconds 1000
  try {
    $shown = Invoke-JsonCommand $orcaExe @('terminal', 'show', '--terminal', $targetTerminal, '--json')
    $term = $shown.result.terminal
    if ($term.connected -and $term.writable -and -not $term.orphaned) {
      $ready = $true
      break
    }
  } catch { }
}
if (-not $ready) {
  try { & $orcaExe terminal close --terminal $targetTerminal --json 2>$null | Out-Null } catch { }
  throw "New controller terminal did not become ready within ${ReadyTimeoutSeconds}s"
}

$transferRaw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controllerScript `
  -Mode Transfer `
  -ConfigPath $located.configPath `
  -Owner $located.owner `
  -Terminal $located.terminal `
  -Generation ([int]$located.generation) `
  -ToOwner $targetOwner `
  -ToTerminal $targetTerminal
if ($LASTEXITCODE -ne 0) {
  throw "Planned transfer dispatch failed: $($transferRaw -join ' ')"
}

$claimDeadline = [DateTime]::UtcNow.AddSeconds($ClaimTimeoutSeconds)
while ([DateTime]::UtcNow -lt $claimDeadline) {
  Start-Sleep -Milliseconds 1500
  try {
    $statusRaw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controllerScript -Mode Status -ConfigPath $located.configPath
    if ($LASTEXITCODE -ne 0) { continue }
    $status = ($statusRaw -join "`n") | ConvertFrom-Json
    if ($status.status -eq 'active' -and $status.owner -eq $targetOwner -and $status.terminal -eq $targetTerminal) {
      [pscustomobject]@{
        verdict = 'TRANSFERRED'
        runId = $located.runId
        previousOwner = $located.owner
        newOwner = $targetOwner
        newTerminal = $targetTerminal
        generation = $status.generation
        agentProfile = $AgentProfile
      } | ConvertTo-Json -Depth 6
      exit 0
    }
  } catch { }
}

[pscustomobject]@{
  verdict = 'TAKEOVER_PENDING'
  runId = $located.runId
  newOwner = $targetOwner
  newTerminal = $targetTerminal
  agentProfile = $AgentProfile
  nextAction = 'Inspect the new terminal; it has the exact claim command and must run /newos-master before orchestration.'
} | ConvertTo-Json -Depth 6
exit 3
