param(
  [string]$StoreDir = (Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\scheduled-store'),
  [string]$Address = '127.0.0.1:3979'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\run-s17-runtime.ps1')
. (Join-Path $PSScriptRoot 'lib\s17-daemon-task.ps1')

Assert-S17ScheduledDaemonAddress -Address $Address | Out-Null
Assert-S17ScheduledDaemonStore -StoreDir $StoreDir | Out-Null
$repo = Assert-S17RepositoryLayout -RepositoryRoot (Get-S17RepositoryRoot -ScriptDirectory $PSScriptRoot)
$daemon = Join-Path $repo 'go\bin\sen-plane.exe'
if (-not (Test-Path $daemon)) {
  Ensure-S17DaemonDirectory -Directory (Split-Path -Parent $daemon) | Out-Null
  Push-Location (Join-Path $repo 'go')
  try {
    & (Get-Command go) build -o (Join-Path (Get-Location) 'bin\sen-plane.exe') './cmd/sen-plane'
    if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/sen-plane failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}
if (-not (Test-Path $daemon)) { throw "expected sen-plane binary not found: $daemon" }

New-Item -ItemType Directory -Force -Path $StoreDir | Out-Null
Assert-S17PortAvailable -DaemonUri ([uri]("http://$Address"))
$env:SEN_PLANE_STORE_DIR = $StoreDir
$env:SEN_PLANE_ADDR = $Address
Remove-Item Env:DESKTOP_SHELL_V2 -ErrorAction SilentlyContinue
& $daemon
exit $LASTEXITCODE
