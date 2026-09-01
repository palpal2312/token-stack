function Get-S17RepositoryRoot {
  param([Parameter(Mandatory = $true)][string]$ScriptDirectory)
  return (Split-Path -Parent $ScriptDirectory)
}

function Assert-S17RepositoryLayout {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)
  $required = @('package.json', 'go', '.git')
  foreach ($entry in $required) {
    if (-not (Test-Path (Join-Path $RepositoryRoot $entry))) {
      throw "S17 runner repository layout missing $entry at $RepositoryRoot"
    }
  }
  $resolved = (& git -C $RepositoryRoot rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $resolved) {
    throw "S17 runner repository root is not a Git worktree: $RepositoryRoot"
  }
  if (([IO.Path]::GetFullPath($resolved)).TrimEnd('\') -ne ([IO.Path]::GetFullPath($RepositoryRoot)).TrimEnd('\')) {
    throw "S17 runner repository root does not match Git top level: $RepositoryRoot"
  }
  return $RepositoryRoot
}

function Ensure-S17DaemonDirectory {
  param([Parameter(Mandatory = $true)][string]$Directory)
  if (-not (Test-Path $Directory)) {
    New-Item -ItemType Directory -Force $Directory | Out-Null
  }
  return $Directory
}

function Restore-S17EnvironmentVariable {
  param([Parameter(Mandatory = $true)][string]$Name, $Value)
  if ($null -eq $Value) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item "Env:$Name" $Value
  }
}

function Wait-S17Healthz {
  param(
    [Parameter(Mandatory = $true)][string]$DaemonUrl,
    [int]$TimeoutSeconds = 15,
    [scriptblock]$Probe = $null,
    $Process = $null,
    [scriptblock]$OwnershipProbe = $null
  )
  if (-not $Probe) {
    $Probe = {
      param($url)
      curl.exe -s -o NUL -w '%{http_code}' "$url/healthz" 2>$null
    }
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ($Process -and $Process.HasExited) { throw 'sen-plane exited before readiness' }
    if ((& $Probe $DaemonUrl) -eq '200') {
      if ($OwnershipProbe -and -not (& $OwnershipProbe $Process $DaemonUrl)) {
        throw 'sen-plane readiness was served by a process other than the spawned daemon'
      }
      return $true
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "sen-plane readiness timed out after $TimeoutSeconds seconds at $DaemonUrl/healthz"
}

function Assert-S17PortAvailable {
  param([Parameter(Mandatory = $true)][uri]$DaemonUri)
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $DaemonUri.Port -ErrorAction SilentlyContinue
  if ($listeners) { throw "sen-plane port $($DaemonUri.Port) is already in use" }
}

function Test-S17DaemonOwnership {
  param($Process, [Parameter(Mandatory = $true)][uri]$DaemonUri)
  if (-not $Process -or $Process.HasExited) { return $false }
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $DaemonUri.Port -ErrorAction SilentlyContinue
  return [bool]($listeners | Where-Object { $_.OwningProcess -eq $Process.Id })
}

function Stop-S17Daemon {
  param($Process)
  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}
