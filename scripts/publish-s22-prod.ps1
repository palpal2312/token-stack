# Publish newsos-s22-prod on loopback :3737 with shared host api-token.
# Required for scripts/run-total-tests.ps1 live overlay (G5).
[CmdletBinding()]
param(
  [string]$Image = 'agent-os-s17:latest',
  [string]$Name = 'newsos-s22-prod',
  [string]$Volume = 'newsos-s22-data',
  [string]$HostPort = '127.0.0.1:3737:3737'
)

$ErrorActionPreference = 'Stop'
$tokenPath = Join-Path $env:USERPROFILE '.agentic-os\api-token'
if (-not (Test-Path -LiteralPath $tokenPath)) {
  throw "Missing host api-token at $tokenPath — start the dashboard once or mint via local bootstrap."
}

if (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $Name) {
  docker stop $Name | Out-Null
  docker rm $Name | Out-Null
}

docker run -d --name $Name --restart unless-stopped `
  -p $HostPort `
  -v "${Volume}:/data" `
  -v "${tokenPath}:/root/.agentic-os/api-token:ro" `
  -e SEN_PLANE_STORE_DIR=/data/store `
  -e NODE_ENV=production `
  -e AGENTIC_OS_ALLOW_TEST_FIXTURE=0 `
  -e AGENTIC_OS_HOST=0.0.0.0 `
  -e AGENTIC_OS_PORT=3737 `
  -e PORT=3737 `
  -e SEN_DAEMON_URL=http://127.0.0.1:3979 `
  $Image | Out-Null

Write-Host "Waiting for healthz on http://127.0.0.1:3737 ..."
for ($i = 0; $i -lt 60; $i++) {
  try {
    $code = (Invoke-WebRequest -Uri 'http://127.0.0.1:3737/api/orchestration/state' -UseBasicParsing -TimeoutSec 3).StatusCode
    if ($code -eq 200) {
      docker ps --filter "name=$Name" --format '{{.Names}} | {{.Ports}} | {{.Status}}'
      Write-Host 'READY'
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 2
}
docker logs --tail 40 $Name
throw 'newsos-s22-prod did not become healthy on 3737'
