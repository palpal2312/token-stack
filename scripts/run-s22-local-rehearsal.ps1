[CmdletBinding()]
param(
  [int]$Port = 3982
)

$ErrorActionPreference = 'Stop'

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "port $Port is already in use"
}

$root = Join-Path $env:TEMP ('newsos-s22-rehearsal-' + [guid]::NewGuid().ToString('N'))
$binary = Join-Path $root 'sen-plane.exe'
$backupCli = Join-Path $root 'newsos-backup.exe'
$store = Join-Path $root 'store'
$restore = Join-Path $root 'restore'
$snapshot = Join-Path $root 'snapshot.db'
$priorStore = $env:SEN_PLANE_STORE_DIR
$priorAddress = $env:SEN_PLANE_ADDR
$first = $null
$second = $null
$third = $null

function Start-IsolatedDaemon([string]$storeRoot) {
  $env:SEN_PLANE_STORE_DIR = $storeRoot
  $env:SEN_PLANE_ADDR = "127.0.0.1:$Port"
  $process = Start-Process -FilePath $binary -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
      if ($health.status -eq 'ok') { return $process }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  throw 'isolated daemon health check failed'
}

try {
  New-Item -ItemType Directory -Path $root | Out-Null
  Push-Location (Join-Path $PSScriptRoot '..\go')
  try {
    go build -o $binary ./cmd/sen-plane
    go build -o $backupCli ./cmd/newsos-backup
  } finally {
    Pop-Location
  }

  $first = Start-IsolatedDaemon $store
  $payload = @{ session_id = 's22-local-rehearsal'; sender = 'user'; text = 'rehearsal-canary' } | ConvertTo-Json -Compress
  $written = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/sen/chat" -ContentType 'application/json' -Body $payload -TimeoutSec 5
  $initial = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/sen/chat?session=s22-local-rehearsal" -TimeoutSec 5
  if ($written.turn_seq -lt 1 -or $initial.turns.Count -lt 1) { throw 'initial canary was not durable' }
  Stop-Process -Id $first.Id -Force
  $first = $null

  & $backupCli backup --store-root $store --backup-file $snapshot | Out-Null
  if (-not (Test-Path -LiteralPath $snapshot)) { throw 'snapshot was not created' }

  $second = Start-IsolatedDaemon $store
  $afterRestart = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/sen/chat?session=s22-local-rehearsal" -TimeoutSec 5
  if ($afterRestart.turns.Count -lt 1) { throw 'restart recovery lost the canary' }
  Stop-Process -Id $second.Id -Force
  $second = $null

  & $backupCli restore --store-root $store --backup-file $snapshot --restore-root $restore | Out-Null
  $third = Start-IsolatedDaemon $restore
  $afterRestore = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/sen/chat?session=s22-local-rehearsal" -TimeoutSec 5
  if ($afterRestore.turns.Count -lt 1) { throw 'restored snapshot did not contain the canary' }

  Write-Output ("S22-LOCAL-REHEARSAL-PASS port={0} initial_turns={1} restart_turns={2} restore_turns={3} snapshot_valid=true isolated=true" -f $Port, $initial.turns.Count, $afterRestart.turns.Count, $afterRestore.turns.Count)
} finally {
  foreach ($process in @($first, $second, $third)) {
    if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  $env:SEN_PLANE_STORE_DIR = $priorStore
  $env:SEN_PLANE_ADDR = $priorAddress
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
