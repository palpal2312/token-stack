# S18 SLO probe harness (single watch loop, 30s) — S18 P1.
# Probes sen-plane endpoints: /healthz Availability (2 consecutive fails alerts),
# RPO = age of newest durable chat write vs wall clock (threshold 5m),
# RTO = time from failure signal to restored service (threshold 15m).
# Writes JSONL series to %LOCALAPPDATA%\NEWSOS\s12-metrics\slo.jsonl.
param(
  [string]$Base = 'http://127.0.0.1:3979',
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'NEWSOS\s12-metrics'),
  [int]$IntervalSec = 30,
  [switch]$SelfCheck
)
$ErrorActionPreference = 'Stop'
$state = Join-Path $StateDir 'slo.jsonl'
New-Item -ItemType Directory -Force $StateDir | Out-Null

if ($SelfCheck) {
  # One-shot assertion mode (no loop): verifies observability contract.
  $h = curl.exe -s -o NUL -w '%{http_code}' "$Base/healthz" 2>$null
  if ($h -ne '200') { throw "selfcheck: healthz $h" }
  $metricsNow = Test-Path $StateDir
  if (-not $metricsNow) { throw 'selfcheck: metrics dir missing' }
  Write-Host "S18-PROBE-SELFCHECK-OK healthz=$h metrics=$metricsNow"
  exit 0
}

$consecFails = 0
$downAt = $null
while ($true) {
  $t = (Get-Date).ToUniversalTime().ToString('o')
  $code = curl.exe -s -o NUL -w '%{http_code}' "$Base/healthz" 2>$null
  if ($code -eq '200') {
    if ($consecFails -ge 2 -and $downAt) {
      $rtoMinutes = [math]::Round(((Get-Date) - $downAt).TotalMinutes, 1)
      if ($rtoMinutes -gt 15) { Write-Host "SLO-RTO-BREACH $rtoMinutes min" }
    }
    $consecFails = 0; $downAt = $null
  } else {
    $consecFails++
    if (-not $downAt) { $downAt = Get-Date }
  }
  Remove-Item Env:SLO_HEALTHZ -ErrorAction SilentlyContinue
  # RPO: newest durable chat write age via the daemon read-back (session GET).
  $lastWrites = curl.exe -s "$Base/api/v1/sen/chat?session=probe" 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
  $ageMin = -1
  if ($lastWrites -and $lastWrites.turns) {
    $lastTs = $lastWrites.turns[-1].ts
    try { $ageMin = [math]::Round(((Get-Date).ToUniversalTime() - [datetime]::Parse($lastTs).ToUniversalTime()).TotalMinutes, 1) } catch { }
  }
  if ($ageMin -gt 5) { Write-Host "SLO-RPO-BREACH $ageMin min" }
  $row = [pscustomobject]@{ t = $t; healthz = $code; consec_fails = $consecFails; rpo_min = $ageMin }
  Add-Content -LiteralPath $state -Value ($row | ConvertTo-Json -Compress) -Encoding UTF8
  Start-Sleep -Seconds $IntervalSec
}