# dev-sen-plane.ps1 - build go/cmd/sen-plane and run it against an isolated DEV store.
#
# Usage: .\scripts\dev-sen-plane.ps1 [-Addr 127.0.0.1:3979] [-StoreDir <dir>]
#   Defaults: SEN_PLANE_ADDR=127.0.0.1:3979, store=%LOCALAPPDATA%\NEWSOS\sen-plane\dev-store.
#   Builds and launches the daemon in its own window, prints the URLs it serves,
#   then waits on the child (PID printed). Read-only-safe: only mkdir's the dev
#   store root if missing. Nothing is installed.

[CmdletBinding()]
param(
  [string]$Addr = '127.0.0.1:3979',
  [string]$StoreDir = (Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\dev-store')
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$goDir = Join-Path $repoRoot 'go'
$exe = Join-Path $goDir 'bin\sen-plane.exe'

Push-Location $goDir
try {
  go build -o $exe ./cmd/sen-plane
  if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/sen-plane failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
if (-not (Test-Path $exe)) { throw "expected binary not found: $exe" }

if (-not (Test-Path $StoreDir)) { New-Item -ItemType Directory -Force $StoreDir | Out-Null }

# Start-Process inherits the current env (PS 5.1 has no -Environment); restore after.
$oldStore = $env:SEN_PLANE_STORE_DIR
$oldAddr = $env:SEN_PLANE_ADDR
$p = $null
try {
  $env:SEN_PLANE_STORE_DIR = $StoreDir
  $env:SEN_PLANE_ADDR = $Addr
  $p = Start-Process -FilePath $exe -PassThru
  Write-Host "sen-plane running (PID $($p.Id)) on http://$Addr - store: $StoreDir"
  Write-Host "  healthz     GET http://$Addr/healthz"
  Write-Host "  slots       GET http://$Addr/api/v1/runtime/slots"
  Write-Host "  attempts    GET http://$Addr/api/v1/runtime/attempts"
  Write-Host "  summary     GET http://$Addr/api/v1/codespace/summary"
  Write-Host "  preference  GET http://$Addr/api/v1/workspace/{workspaceId}/execution-preference"
  Write-Host "waiting on sen-plane (PID $($p.Id))..."
  try { Wait-Process -Id $p.Id }
  catch { Write-Host "sen-plane exited early (PID $($p.Id)): $($_.Exception.Message)"; exit 1 }
} finally {
  $env:SEN_PLANE_STORE_DIR = $oldStore
  $env:SEN_PLANE_ADDR = $oldAddr
}