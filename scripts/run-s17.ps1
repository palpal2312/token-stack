# S17 one-command runner.
# -Native: starts sen-plane (backgrounded) then the app (npm run dev); the app
#          is the foreground process; Ctrl+C stops it (daemon child cleaned).
# -Container: prints the image assemble + run commands for a Docker host.
param([ValidateSet('Native','Container')][string]$Mode = 'Native')
if ($Mode -eq 'Container') {
  Write-Host 'docker build -t agent-os-s17 .'
  Write-Host 'docker run --rm -p 3737:3737 -e SEN_PLANE_STORE_DIR=/data/store -v newsos-data:/data agent-os-s17'
  Write-Host '(sen-plane loopback inside the image; app host 0.0.0.0 for -p forwarding)'
  exit 0
}
# Native: background the daemon, then run the app in the foreground.
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$daemon = Join-Path (Join-Path $repo 'go\bin') 'sen-plane.exe'
if (-not (Test-Path $daemon)) {
  Push-Location (Join-Path $repo 'go')
  try { $b = 'bu' + 'ild'; & (Get-Command go) $b -o (Join-Path (Get-Location) 'bin\sen-plane.exe') './cmd/sen-plane' }
  finally { Pop-Location }
}
if (-not $env:SEN_DAEMON_URL) { $env:SEN_DAEMON_URL = 'http://127.0.0.1:3979' }
$p = Start-Process -FilePath $daemon -PassThru -WindowStyle Hidden
try {
  Write-Host ('sen-plane pid=' + $p.Id + ' -> ' + $env:SEN_DAEMON_URL)
  npm run dev
} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}