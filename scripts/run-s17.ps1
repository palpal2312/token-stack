# S17 one-command runner (+ S19 shell rollout switch).
# -Native: starts sen-plane (backgrounded) then the app (npm run dev); the app
#          is the foreground process; Ctrl+C stops it (daemon child cleaned).
# -Container: prints the image assemble + run commands for a Docker host.
# -Shell: sets DESKTOP_SHELL_V2=1 for the app process (S19 rollout; rollback =
#         run without -Shell).
param([ValidateSet('Native','Container')][string]$Mode = 'Native',
      [switch]$Shell,
      [string]$StoreDir,
      [string]$DaemonUrl,
      [int]$ReadinessTimeoutSeconds = 15,
      [switch]$HealthCheckOnly)
if ($Mode -eq 'Container') {
  Write-Host 'docker build -t agent-os-s17 .'
  Write-Host 'docker run --rm -p 3737:3737 -e SEN_PLANE_STORE_DIR=/data/store -v newsos-data:/data agent-os-s17'
  Write-Host '(sen-plane loopback inside the image; app host 0.0.0.0 for -p forwarding)'
  exit 0
}
# Native: background the daemon, then run the app in the foreground.
. (Join-Path $PSScriptRoot 'lib\run-s17-runtime.ps1')
$repo = Assert-S17RepositoryLayout -RepositoryRoot (Get-S17RepositoryRoot -ScriptDirectory $PSScriptRoot)
$daemon = Join-Path (Join-Path $repo 'go\bin') 'sen-plane.exe'
if (-not (Test-Path $daemon)) {
  Push-Location (Join-Path $repo 'go')
  try {
    Ensure-S17DaemonDirectory -Directory (Split-Path -Parent $daemon)
    $b = 'bu' + 'ild'
    & (Get-Command go) $b -o (Join-Path (Get-Location) 'bin\sen-plane.exe') './cmd/sen-plane'
    if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/sen-plane failed (exit $LASTEXITCODE)" }
  }
  finally { Pop-Location }
}
if (-not (Test-Path $daemon)) { throw "expected sen-plane binary not found: $daemon" }
$oldDaemonUrl = $env:SEN_DAEMON_URL
$oldStoreDir = $env:SEN_PLANE_STORE_DIR
$oldDaemonAddr = $env:SEN_PLANE_ADDR
$oldShell = $env:DESKTOP_SHELL_V2
$p = $null
try {
  if (-not $DaemonUrl) { $DaemonUrl = if ($oldDaemonUrl) { $oldDaemonUrl } else { 'http://127.0.0.1:3979' } }
  $daemonUri = [uri]$DaemonUrl
  if (-not $daemonUri.IsLoopback) { throw "S17 Native daemon URL must be loopback: $DaemonUrl" }
  if (-not $StoreDir) { $StoreDir = if ($oldStoreDir) { $oldStoreDir } else { Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\native-store' } }
  New-Item -ItemType Directory -Force $StoreDir | Out-Null
  $env:SEN_DAEMON_URL = $daemonUri.AbsoluteUri.TrimEnd('/')
  $env:SEN_PLANE_STORE_DIR = $StoreDir
  $env:SEN_PLANE_ADDR = "$($daemonUri.Host):$($daemonUri.Port)"
  Remove-Item Env:DESKTOP_SHELL_V2 -ErrorAction SilentlyContinue
  if ($Shell) { $env:DESKTOP_SHELL_V2 = '1'; Write-Host 'DESKTOP_SHELL_V2=1 (S19 shell rollout)' }
  Assert-S17PortAvailable -DaemonUri $daemonUri
  $p = Start-Process -FilePath $daemon -PassThru -WindowStyle Hidden
  Wait-S17Healthz -DaemonUrl $env:SEN_DAEMON_URL -TimeoutSeconds $ReadinessTimeoutSeconds -Process $p -OwnershipProbe ${function:Test-S17DaemonOwnership}
  Write-Host ('sen-plane pid=' + $p.Id + ' -> ' + $env:SEN_DAEMON_URL)
  if (-not $HealthCheckOnly) { npm run dev }
} finally {
  Stop-S17Daemon -Process $p
  Restore-S17EnvironmentVariable -Name 'SEN_DAEMON_URL' -Value $oldDaemonUrl
  Restore-S17EnvironmentVariable -Name 'SEN_PLANE_STORE_DIR' -Value $oldStoreDir
  Restore-S17EnvironmentVariable -Name 'SEN_PLANE_ADDR' -Value $oldDaemonAddr
  Restore-S17EnvironmentVariable -Name 'DESKTOP_SHELL_V2' -Value $oldShell
}
