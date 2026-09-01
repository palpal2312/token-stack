# S17 one-command runner: -Native starts sen-plane + next dev; -Container prints
# the docker build+run commands (Docker-capable host only).
param([ValidateSet('Native','Container')][string]$Mode = 'Native')
if ($Mode -eq 'Container') {
  Write-Host 'docker build -t agent-os-s17 .'
  Write-Host 'docker run --rm -p 3737:3737 -e SEN_PLANE_STORE_DIR=/data/store -v newsos-data:/data agent-os-s17'
  Write-Host '(loopback daemon inside container; canonical chat reachable via SEN_DAEMON_URL default)'
  exit 0
}
# Native: reuse the S14 dev-loop (compile daemon + launch against dev store).
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-sen-plane.ps1')
