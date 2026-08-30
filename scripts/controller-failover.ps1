param(
  [ValidateSet('Heartbeat', 'Check', 'Claim', 'Release', 'Status', 'Transfer')]
  [string]$Mode = 'Check',
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\plans\reports\orchestrate-260825-sprint02-close\controller-failover.json'),
  [string]$Owner,
  [string]$Terminal,
  [string]$ToOwner,
  [string]$ToTerminal,
  [int]$Generation = -1
)

$ErrorActionPreference = 'Stop'

function Set-Property($Object, [string]$Name, $Value) {
  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Invoke-OrcaJson([string[]]$CommandArgs) {
  $raw = & $script:orcaExe @CommandArgs --json 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "orca command failed: $($CommandArgs -join ' ')"
  }
  return ($raw -join "`n") | ConvertFrom-Json
}

function Get-OrcaTerminal([string]$Handle) {
  try {
    $shown = Invoke-OrcaJson @('terminal', 'show', '--terminal', $Handle)
    if ($shown.result.terminal.orphaned) { return $null }
    return $shown.result.terminal
  } catch {
    return $null
  }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Controller failover config not found: $ConfigPath"
}
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

$stateDir = Join-Path $env:LOCALAPPDATA 'NEWSOS'
if (-not (Test-Path -LiteralPath $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}
$stateDir = (Resolve-Path -LiteralPath $stateDir).Path
function Resolve-StateChild([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name) -or [IO.Path]::GetFileName($Name) -ne $Name) {
    throw "State artifact must be a leaf filename"
  }
  $candidate = [IO.Path]::GetFullPath((Join-Path $stateDir $Name))
  $parent = [IO.Path]::GetFullPath((Split-Path -Parent $candidate))
  if (-not [string]::Equals($parent, $stateDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw "State artifact escaped NEWSOS state directory"
  }
  return $candidate
}
$statePath = Resolve-StateChild $config.stateFileName
$incidentPath = Resolve-StateChild $config.incidentLogName

$workspace = (Resolve-Path -LiteralPath $config.workspace).Path
$handoffRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'plans\handoffs'))
$handoffPath = (Resolve-Path -LiteralPath $config.handoffPath).Path
if (-not $handoffPath.StartsWith($handoffRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Handoff path must stay under the workspace plans/handoffs directory"
}

$script:orcaExe = $config.orcaExe
if (-not (Test-Path -LiteralPath $script:orcaExe)) {
  $script:orcaExe = (Get-Command orca -ErrorAction Stop).Source
}
if ([IO.Path]::GetFileName($script:orcaExe) -ne 'orca.exe') {
  throw "Resolved Orca executable is not orca.exe"
}

$mutex = [Threading.Mutex]::new($false, "Global\NEWSOS-Controller-$($config.runId)")
if (-not $mutex.WaitOne(0)) {
  Write-Output 'MUTEX_BUSY'
  exit 3
}

function Read-State {
  if (Test-Path -LiteralPath $statePath) {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  }
  $now = [DateTime]::UtcNow.ToString('o')
  return [pscustomobject]@{
    schemaVersion = 1
    runId = $config.runId
    generation = 1
    status = 'active'
    owner = $config.master.id
    terminal = $config.master.terminal
    heartbeatAt = $now
    heartbeatSource = 'initialization'
    takeoverOwner = $null
    takeoverTerminal = $null
    takeoverDispatchedAt = $null
    takeoverReason = $null
    attemptedSuccessors = @()
  }
}

function Save-State($State) {
  $tmpPath = Join-Path $stateDir ("$($config.stateFileName).$PID.tmp")
  $json = $State | ConvertTo-Json -Depth 10
  $utf8NoBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
  Move-Item -LiteralPath $tmpPath -Destination $statePath -Force
}

function Write-Incident([string]$Message) {
  $line = "{0} {1}{2}" -f [DateTime]::UtcNow.ToString('o'), $Message, [Environment]::NewLine
  [IO.File]::AppendAllText($incidentPath, $line, [Text.UTF8Encoding]::new($false))
}

try {
  $state = Read-State
  $now = [DateTime]::UtcNow

  if ($Mode -eq 'Status') {
    $state | ConvertTo-Json -Depth 10
    exit 0
  }

  if ($Mode -eq 'Heartbeat') {
    if ($state.status -ne 'active') {
      throw "Heartbeat refused while lease status is $($state.status)"
    }
    if ($Owner -and $Owner -ne $state.owner) {
      throw "Heartbeat owner mismatch"
    }
    if ($Terminal -and $Terminal -ne $state.terminal) {
      throw "Heartbeat terminal mismatch"
    }
    Set-Property $state 'heartbeatAt' $now.ToString('o')
    Set-Property $state 'heartbeatSource' 'controller'
    Save-State $state
    Write-Output "HEARTBEAT owner=$($state.owner) generation=$($state.generation)"
    exit 0
  }

  if ($Mode -eq 'Release') {
    if (-not $Owner -or $Owner -ne $state.owner) {
      throw "Release owner mismatch"
    }
    if ($Generation -ne [int]$state.generation) {
      throw "Release generation mismatch"
    }
    Set-Property $state 'status' 'released'
    Set-Property $state 'heartbeatAt' $now.ToString('o')
    Set-Property $state 'heartbeatSource' 'controller-release'
    Save-State $state
    Write-Output "RELEASED owner=$($state.owner) generation=$($state.generation)"
    exit 0
  }

  if ($Mode -eq 'Transfer') {
    if ($state.status -ne 'active') {
      throw "Planned transfer refused while lease status is $($state.status)"
    }
    if (-not $Owner -or $Owner -ne $state.owner) {
      throw 'Planned transfer owner mismatch'
    }
    if (-not $Terminal -or $Terminal -ne $state.terminal) {
      throw 'Planned transfer source terminal mismatch'
    }
    if ($Generation -ne [int]$state.generation) {
      throw "Planned transfer generation mismatch"
    }
    if ([string]::IsNullOrWhiteSpace($ToOwner) -or [string]::IsNullOrWhiteSpace($ToTerminal)) {
      throw 'Planned transfer requires -ToOwner and -ToTerminal'
    }
    if ($ToOwner -eq $state.owner -or $ToTerminal -eq $state.terminal) {
      throw 'Planned transfer target must be a new owner and terminal'
    }
    $targetTerm = Get-OrcaTerminal $ToTerminal
    if (-not $targetTerm -or -not $targetTerm.connected -or -not $targetTerm.writable) {
      throw 'Planned transfer target terminal is not connected and writable'
    }

    $claim = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode Claim -ConfigPath `"$ConfigPath`" -Owner `"$ToOwner`" -Terminal `"$ToTerminal`" -Generation $($state.generation)"
    $prompt = "PLANNED_CONTROLLER_TRANSFER run=$($config.runId) generation=$($state.generation). Invoke /newos-master immediately. Read the handoff at $handoffPath and both master handbooks, verify repository and Orca state, then claim with: $claim . Do not issue orchestration commands before claim. After claim, act as coordination-only Lead Orchestrator; never revive a released run or start Phase 21 without its gate."

    # Persist planned authorization before sending. The exact target may claim
    # this generation even when it is a fresh terminal not in the standby list.
    Set-Property $state 'status' 'takeover_dispatched'
    Set-Property $state 'takeoverOwner' $ToOwner
    Set-Property $state 'takeoverTerminal' $ToTerminal
    Set-Property $state 'takeoverDispatchedAt' $now.ToString('o')
    Set-Property $state 'takeoverReason' 'planned'
    Save-State $state
    try {
      Invoke-OrcaJson @('terminal', 'send', '--terminal', $ToTerminal, '--text', $prompt, '--enter') | Out-Null
    } catch {
      Write-Incident "PLANNED_TRANSFER_SEND_FAILED owner=$ToOwner terminal=$ToTerminal generation=$($state.generation)"
      Write-Output "PLANNED_TRANSFER_SEND_FAILED owner=$ToOwner terminal=$ToTerminal generation=$($state.generation)"
      exit 2
    }
    Write-Incident "PLANNED_TRANSFER_DISPATCHED owner=$ToOwner terminal=$ToTerminal generation=$($state.generation)"
    Write-Output "PLANNED_TRANSFER_DISPATCHED owner=$ToOwner terminal=$ToTerminal generation=$($state.generation)"
    exit 0
  }

  $heartbeat = [DateTime]::Parse($state.heartbeatAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  $stale = ($now - $heartbeat).TotalSeconds -ge [int]$config.staleAfterSeconds

  if ($Mode -eq 'Claim') {
    if (-not $Owner -or -not $Terminal) {
      throw 'Claim requires -Owner and -Terminal'
    }
    if ($Generation -ne [int]$state.generation) {
      throw "Stale takeover generation $Generation; current generation is $($state.generation)"
    }
    $authorizedDispatch = $state.status -eq 'takeover_dispatched' -and $state.takeoverOwner -eq $Owner -and $state.takeoverTerminal -eq $Terminal
    $plannedTransfer = $state.takeoverReason -eq 'planned'
    $allowedSuccessor = $plannedTransfer -or @($config.successors | Where-Object { $_.id -eq $Owner -and $_.terminal -eq $Terminal }).Count -eq 1
    if (-not $authorizedDispatch -or -not $allowedSuccessor) {
      throw "Claim is not the currently dispatched allowlisted successor"
    }
    Set-Property $state 'generation' ([int]$state.generation + 1)
    Set-Property $state 'status' 'active'
    Set-Property $state 'owner' $Owner
    Set-Property $state 'terminal' $Terminal
    Set-Property $state 'heartbeatAt' $now.ToString('o')
    Set-Property $state 'heartbeatSource' 'successor-claim'
    Set-Property $state 'takeoverOwner' $null
    Set-Property $state 'takeoverTerminal' $null
    Set-Property $state 'takeoverDispatchedAt' $null
    Set-Property $state 'takeoverReason' $null
    Set-Property $state 'attemptedSuccessors' @()
    Save-State $state
    Write-Incident "CLAIM owner=$Owner terminal=$Terminal generation=$($state.generation)"
    Write-Output "CLAIMED owner=$Owner generation=$($state.generation)"
    exit 0
  }

  if ($state.status -eq 'released') {
    Write-Output "RELEASED owner=$($state.owner) generation=$($state.generation)"
    exit 0
  }

  # Resolve by runtime handle rather than by one worktree. Standby controllers
  # intentionally live in different lane worktrees.
  $ownerTerm = Get-OrcaTerminal $state.terminal
  if ($state.status -eq 'active' -and $ownerTerm -and $ownerTerm.lastOutputAt) {
    $lastOutput = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$ownerTerm.lastOutputAt).UtcDateTime
    if ($lastOutput -gt $heartbeat) {
      Set-Property $state 'heartbeatAt' $lastOutput.ToString('o')
      Set-Property $state 'heartbeatSource' 'orca-output-observer'
      Set-Property $state 'status' 'active'
      Save-State $state
      $heartbeat = $lastOutput
      $stale = ($now - $heartbeat).TotalSeconds -ge [int]$config.staleAfterSeconds
    }
  }

  if (-not $stale) {
    Write-Output "HEALTHY owner=$($state.owner) generation=$($state.generation) heartbeat=$($state.heartbeatAt)"
    exit 0
  }

  $ownerIdle = $true
  if ($ownerTerm -and $ownerTerm.connected -and $ownerTerm.writable) {
    try {
      $wait = Invoke-OrcaJson @('terminal', 'wait', '--terminal', $ownerTerm.handle, '--for', 'tui-idle', '--timeout-ms', '1000')
      $ownerIdle = [bool]$wait.result.wait.satisfied
    } catch {
      $ownerIdle = $false
    }
  }
  if ($ownerTerm -and $ownerTerm.connected -and -not $ownerIdle) {
    Write-Output "AT_RISK owner=$($state.owner) heartbeat stale but terminal is busy; takeover deferred"
    exit 0
  }

  if ($state.status -eq 'takeover_dispatched' -and $state.takeoverDispatchedAt) {
    $dispatchedAt = [DateTime]::Parse($state.takeoverDispatchedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    if (($now - $dispatchedAt).TotalSeconds -lt [int]$config.dispatchCooldownSeconds) {
      Write-Output "TAKEOVER_PENDING owner=$($state.takeoverOwner) terminal=$($state.takeoverTerminal)"
      exit 0
    }

    # Never dispatch two successors in one generation. If the dispatched
    # standby is still busy it owns the pending attempt. If it returned idle
    # without claiming, invalidate that prompt by advancing the generation
    # before considering the next allowlisted standby.
    $pendingTerm = Get-OrcaTerminal $state.takeoverTerminal
    $pendingIdle = $true
    if ($pendingTerm -and $pendingTerm.connected -and $pendingTerm.writable) {
      try {
        $pendingWait = Invoke-OrcaJson @('terminal', 'wait', '--terminal', $pendingTerm.handle, '--for', 'tui-idle', '--timeout-ms', '1000')
        $pendingIdle = [bool]$pendingWait.result.wait.satisfied
      } catch {
        $pendingIdle = $false
      }
    }
    if ($pendingTerm -and $pendingTerm.connected -and -not $pendingIdle) {
      Write-Output "TAKEOVER_PENDING owner=$($state.takeoverOwner) terminal=$($state.takeoverTerminal) busy=true"
      exit 0
    }

    $failedOwner = $state.takeoverOwner
    Set-Property $state 'generation' ([int]$state.generation + 1)
    Set-Property $state 'status' 'active'
    Set-Property $state 'takeoverOwner' $null
    Set-Property $state 'takeoverTerminal' $null
    Set-Property $state 'takeoverDispatchedAt' $null
    Set-Property $state 'takeoverReason' $null
    Save-State $state
    Write-Incident "TAKEOVER_ABANDONED owner=$failedOwner nextGeneration=$($state.generation)"
  }

  $successor = $null
  $attempted = @($state.attemptedSuccessors)
  foreach ($candidate in @($config.successors | Sort-Object priority)) {
    if ($candidate.terminal -eq $state.terminal) { continue }
    if ($attempted -contains $candidate.id) { continue }
    $term = Get-OrcaTerminal $candidate.terminal
    if (-not $term -or -not $term.connected -or -not $term.writable) { continue }
    try {
      $wait = Invoke-OrcaJson @('terminal', 'wait', '--terminal', $term.handle, '--for', 'tui-idle', '--timeout-ms', '1000')
      if ([bool]$wait.result.wait.satisfied) {
        $successor = [pscustomobject]@{ id = $candidate.id; terminal = $term.handle }
        break
      }
    } catch { }
  }

  if (-not $successor) {
    Write-Incident "NO_SUCCESSOR_AVAILABLE generation=$($state.generation)"
    Write-Output 'NO_SUCCESSOR_AVAILABLE'
    exit 2
  }

  $handoff = $handoffPath
  $claim = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode Claim -ConfigPath `"$ConfigPath`" -Owner `"$($successor.id)`" -Terminal `"$($successor.terminal)`" -Generation $($state.generation)"
  $prompt = "CONTROLLER_FAILOVER run=$($config.runId) generation=$($state.generation). The previous controller lease is stale and its terminal is idle/disconnected. Read $handoff and verify Current state against the repository before acting. Claim the lease first with: $claim . Then act only as Lead Orchestrator: reconcile Orca terminals, preserve worktrees and user changes, dispatch/review but do not code, update the handoff and heartbeat, and keep Phase 21 blocked unless explicitly authorized."
  # Authorize and persist before sending. A crash after send cannot leave the
  # lease looking undispatched; a send failure remains pending and is handled
  # after the cooldown in a new generation.
  Set-Property $state 'status' 'takeover_dispatched'
  Set-Property $state 'takeoverOwner' $successor.id
  Set-Property $state 'takeoverTerminal' $successor.terminal
  Set-Property $state 'takeoverDispatchedAt' $now.ToString('o')
  Set-Property $state 'takeoverReason' 'failover'
  Set-Property $state 'attemptedSuccessors' @($attempted + $successor.id)
  Save-State $state
  try {
    Invoke-OrcaJson @('terminal', 'send', '--terminal', $successor.terminal, '--text', $prompt, '--enter') | Out-Null
  } catch {
    Write-Incident "TAKEOVER_SEND_FAILED owner=$($successor.id) terminal=$($successor.terminal) generation=$($state.generation)"
    Write-Output "TAKEOVER_SEND_FAILED owner=$($successor.id) terminal=$($successor.terminal)"
    exit 2
  }
  Write-Incident "TAKEOVER_DISPATCHED owner=$($successor.id) terminal=$($successor.terminal) generation=$($state.generation)"
  Write-Output "TAKEOVER_DISPATCHED owner=$($successor.id) terminal=$($successor.terminal)"
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
