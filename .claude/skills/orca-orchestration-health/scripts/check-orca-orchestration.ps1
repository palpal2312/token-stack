[CmdletBinding()]
param(
  [switch]$Json,
  [string]$ProjectPath = (Get-Location).Path,
  [int]$ListenerProbeTimeoutMs = 1200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-Result {
  param([string]$Status, [string]$Reason)
  [pscustomobject]@{ status = $Status; reason = $Reason }
}

function Test-HttpEndpoint {
  param([int]$Port, [string]$Path)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec ([math]::Max(1, [int]($ListenerProbeTimeoutMs / 1000))) "http://127.0.0.1:$Port$Path"
    $body = [string]$response.Content
    [pscustomobject]@{ statusCode = [int]$response.StatusCode; body = $body }
  } catch {
    $statusCode = 0
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode.value__ }
    [pscustomobject]@{ statusCode = $statusCode; body = '' }
  }
}

function Get-LoopbackPorts {
  $ports = @()
  try {
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1', '::') } |
      Select-Object -ExpandProperty LocalPort -Unique |
      Sort-Object)
  } catch {
    # Fallback supports older Windows PowerShell installations.
    $ports = @(netstat -ano -p tcp 2>$null |
      Select-String 'LISTENING' |
      ForEach-Object {
        if ($_.Line -match ':(\d+)\s+.*LISTENING') { [int]$Matches[1] }
      } |
      Sort-Object -Unique)
  }
  @($ports | Where-Object { $_ -gt 0 -and $_ -lt 65536 })
}

function Get-HeadroomServices {
  $services = @()
  foreach ($port in Get-LoopbackPorts) {
    foreach ($path in @('/readyz', '/health')) {
      $probe = Test-HttpEndpoint -Port $port -Path $path
      if ($probe.statusCode -eq 200 -and $probe.body -match 'headroom-proxy') {
        $body = $null
        try { $body = $probe.body | ConvertFrom-Json } catch {}
        $upstreamHealthy = $false
        if ($body -and $body.checks -and $body.checks.upstream -and $body.checks.upstream.status -eq 'healthy') {
          $upstreamHealthy = $true
        }
        $services += [pscustomobject]@{
          port = [int]$port
          endpoint = $path
          status = if ($body.status -eq 'healthy') { 'healthy' } else { 'degraded' }
          version = if ($body.version) { [string]$body.version } else { $null }
          upstreamHealthy = $upstreamHealthy
        }
        break
      }
    }
  }
  @($services | Sort-Object port -Unique)
}

function Get-DaemonState {
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'orca-terminal-daemon.exe'" -ErrorAction SilentlyContinue)
  $pidFile = Join-Path $env:APPDATA 'orca\daemon\daemon-v34.pid'
  $logFile = Join-Path $env:APPDATA 'orca\logs\daemon.log'
  $pidRecord = $null
  if (Test-Path $pidFile) {
    try { $pidRecord = Get-Content $pidFile -Raw | ConvertFrom-Json } catch {}
  }
  [pscustomobject]@{
    status = if ($processes.Count -gt 0) { 'running' } else { 'not-running' }
    pids = @($processes | Select-Object -ExpandProperty ProcessId)
    pidFilePresent = Test-Path $pidFile
    pidFile = $pidFile
    logFile = $logFile
    version = if ($pidRecord.appVersion) { [string]$pidRecord.appVersion } else { $null }
  }
}

function Get-ProjectSessions {
  $logFile = Join-Path $env:APPDATA 'orca\logs\daemon.log'
  if (-not (Test-Path $logFile)) { return @() }
  $normalizedProject = ($ProjectPath -replace '\\', '/')
  $events = @()
  foreach ($line in (Get-Content $logFile -Tail 1000)) {
    try {
      $event = $line | ConvertFrom-Json
      if ($event.sessionId -and ([string]$event.sessionId).ToLowerInvariant().Contains($normalizedProject.ToLowerInvariant())) {
        $events += $event
      }
    } catch {}
  }
  @($events | Group-Object sessionId | ForEach-Object {
    $last = $_.Group | Select-Object -Last 1
    $active = $last.event -in @('session-created', 'session-attached')
    [pscustomobject]@{
      session = ([string]$_.Name -replace '^.*::', '')
      status = if ($active) { 'active-evidence' } elseif ($last.event -in @('session-killed', 'session-exited')) { 'stopped-evidence' } else { 'unknown' }
      lastEvent = [string]$last.event
      lastSeen = [string]$last.ts
    }
  } | Sort-Object lastSeen -Descending)
}

function Get-RuntimeSlots {
  $services = @(Get-HeadroomServices)
  foreach ($service in $services) {
    $probe = Test-HttpEndpoint -Port $service.port -Path '/api/v1/runtime/slots'
    if ($probe.statusCode -eq 200) {
      return [pscustomobject]@{ status = 'available'; port = $service.port }
    }
    if ($probe.statusCode -eq 404) {
      return [pscustomobject]@{ status = 'missing'; port = $service.port }
    }
  }
  [pscustomobject]@{ status = 'not-probed'; port = $null }
}

$headroom = @(Get-HeadroomServices)
$result = [pscustomobject]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  projectPath = $ProjectPath
  daemon = Get-DaemonState
  headroom = $headroom
  projectSessions = @(Get-ProjectSessions)
  runtimeSlots = Get-RuntimeSlots
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
  exit 0
}

"Orca orchestration health"
"project=$($result.projectPath)"
"daemon=$($result.daemon.status) pids=$([string]::Join(',', [array]$result.daemon.pids)) version=$($result.daemon.version)"
if ($headroom.Count -eq 0) {
  'headroom=not-found'
} else {
  foreach ($service in $headroom) {
    "headroom=healthy port=$($service.port) endpoint=$($service.endpoint) upstreamHealthy=$($service.upstreamHealthy) version=$($service.version)"
  }
}
if (@($result.projectSessions).Count -eq 0) {
  'projectSessions=none-found'
} else {
  foreach ($session in $result.projectSessions) {
    "projectSession=$($session.status) lastEvent=$($session.lastEvent) lastSeen=$($session.lastSeen) session=$($session.session)"
  }
}
"runtimeSlots=$($result.runtimeSlots.status) port=$($result.runtimeSlots.port)"
