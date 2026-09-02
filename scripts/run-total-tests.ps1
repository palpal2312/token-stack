# Total E2E test script (post-Phase-21).
# Runs static suites, the isolated durability rehearsal, and the available live
# production-container overlay. Every run writes a JSON receipt.
[CmdletBinding()]
param([switch]$SkipLive)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$rows = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Name, [string]$Status, [string]$Detail, [double]$Seconds = 0) {
  $rows.Add([pscustomobject]@{ step = $Name; status = $Status; seconds = [math]::Round($Seconds, 2); detail = $Detail })
  $color = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
  Write-Host ('[{0}] {1} ({2}s)' -f $Status, $Name, [math]::Round($Seconds, 2)) -ForegroundColor $color
  if ($Detail) { Write-Host ('       {0}' -f $Detail) -ForegroundColor DarkGray }
}

function Invoke-Step([string]$Name, [scriptblock]$Block) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $detail = [string](& $Block)
    $sw.Stop()
    Add-Result $Name 'PASS' $detail $sw.Elapsed.TotalSeconds
  } catch {
    $sw.Stop()
    Add-Result $Name 'FAIL' $_.Exception.Message $sw.Elapsed.TotalSeconds
  }
}

function Invoke-RepoCommand([scriptblock]$Command, [string]$Failure) {
  Push-Location $root
  try {
    $out = & $Command 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "$Failure exit=$LASTEXITCODE`n$($out.Trim())" }
    return $out.Trim()
  } finally { Pop-Location }
}

function Get-OrchToken() {
  $candidates = [System.Collections.Generic.List[string]]::new()
  $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  if (-not [string]::IsNullOrWhiteSpace($profile)) { $candidates.Add((Join-Path $profile '.agentic-os\api-token')) }
  if (-not [string]::IsNullOrWhiteSpace($env:AGENTIC_OS_HOME)) { $candidates.Add((Join-Path $env:AGENTIC_OS_HOME 'api-token')) }
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $token = (Get-Content -LiteralPath $path -Raw).Trim()
      if ($token) { return $token }
    }
  }
  return $null
}

function Get-Status([scriptblock]$Request) {
  try { return [int](& $Request) }
  catch {
    $response = $_.Exception.Response
    if ($null -ne $response) { return [int]$response.StatusCode }
    return -1
  }
}

function Get-LiveSkipReason() {
  try {
    $names = @(docker ps --filter 'name=newsos-s22-prod' --format '{{.Names}}' 2>$null)
    if (@($names | Where-Object { $_ -eq 'newsos-s22-prod' }).Count -eq 0) { return 'container newsos-s22-prod not running' }
    $portMap = (docker inspect --format '{{json .NetworkSettings.Ports}}' newsos-s22-prod 2>$null | ConvertFrom-Json)
    $hostPorts = @($portMap.'3737/tcp' | Where-Object { -not [string]::IsNullOrWhiteSpace($_.HostPort) })
    if ($hostPorts.Count -eq 0) { return 'container newsos-s22-prod does not publish 3737/tcp to the host' }
    return $null
  } catch { return 'Docker is unavailable for the live overlay' }
}

Invoke-Step 'npm test' {
  $out = Invoke-RepoCommand { npm.cmd test } 'npm test'
  (($out -split "`n" | Where-Object { $_ -match '(^|\s)(tests|pass|fail) \d+' }) -join '; ')
}
Invoke-Step 'go:check' {
  $out = Invoke-RepoCommand { npm.cmd run go:check } 'go:check'
  if ($out -match '(?m)^\s*(FAIL|--- FAIL)') { throw $out }
  'go vet + test OK'
}
Invoke-Step 'tsc --noEmit' { Invoke-RepoCommand { npx.cmd tsc --noEmit } 'tsc'; 'tsc: 0 errors' }
Invoke-Step 'protected:check' {
  $out = Invoke-RepoCommand { npm.cmd run protected:check } 'protected:check'
  if ($out -notmatch 'PROTECTED-CONTROLS-OK') { throw 'protected-controls guard did not report success' }
  ($out -split "`n" | Where-Object { $_ -match 'PROTECTED-CONTROLS' }) -join '; '
}
Invoke-Step 'pester (S17 harness)' { Invoke-RepoCommand { npm.cmd run pester:runner } 'pester'; 'pester OK' }
Invoke-Step 'S22 local rehearsal' { & (Join-Path $PSScriptRoot 'run-s22-local-rehearsal.ps1') -Port 3984 }

$liveReason = if ($SkipLive) { 'skipped by -SkipLive' } else { Get-LiveSkipReason }
if ($liveReason) {
  foreach ($name in @('live container healthz', 'live canary write+readback', 'live legacy surfaces inert')) { Add-Result $name 'SKIP' $liveReason }
} else {
  Invoke-Step 'live container healthz' {
    for ($i = 0; $i -lt 30; $i++) {
      try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3737/api/orchestration/state' -TimeoutSec 3
        if ($response.StatusCode -eq 200) { return 'healthz 200 on 3737' }
      } catch { Start-Sleep -Seconds 2 }
    }
    throw 'healthz on 3737 not 200'
  }
  Invoke-Step 'live canary write+readback' {
    $token = Get-OrchToken
    if (-not $token) { throw 'api-token not found' }
    $headers = @{ 'x-agentic-os-token' = $token }
    $sessionId = 'e2e-total-' + (Get-Date -Format 'yyyyMMddHHmmss')
    $body = @{ sessionId = $sessionId; content = "total e2e canary $(Get-Date -Format 'HH:mm:ss')" } | ConvertTo-Json -Compress
    $posted = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3737/api/sen/chat' -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 15
    if ($posted.StatusCode -ne 200) { throw "POST $($posted.StatusCode)" }
    $receipt = $posted.Content | ConvertFrom-Json
    if (-not $receipt.commandId -or -not $receipt.turnId -or -not $receipt.chatAttemptId -or $receipt.sessionId -ne $sessionId -or $receipt.turnSeq -lt 1) { throw 'POST receipt missing canonical ids' }
    $readback = Invoke-WebRequest -Uri "http://127.0.0.1:3737/api/sen/chat?session=$sessionId" -Headers $headers -TimeoutSec 15
    if ($readback.StatusCode -ne 200) { throw "GET $($readback.StatusCode)" }
    $thread = $readback.Content | ConvertFrom-Json
    if (-not $thread.canonical -or @($thread.turns).Count -lt 1) { throw 'readback not canonical or empty' }
    "turn $sessionId durable (canonical=$($thread.canonical), turns=$(@($thread.turns).Count))"
  }
  Invoke-Step 'live legacy surfaces inert' {
    $token = Get-OrchToken
    if (-not $token) { throw 'api-token not found' }
    $headers = @{ 'x-agentic-os-token' = $token }
    $patch = Get-Status { (Invoke-WebRequest -Method Patch -Uri 'http://127.0.0.1:3737/api/sen/chat' -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 10).StatusCode }
    $delete = Get-Status { (Invoke-WebRequest -Method Delete -Uri 'http://127.0.0.1:3737/api/sen/chat' -Headers $headers -TimeoutSec 10).StatusCode }
    $firstmate = Get-Status { (Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3737/api/firstmate/chat' -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 10).StatusCode }
    if ($patch -ne 501 -or $delete -ne 501 -or $firstmate -ne 410) { throw "got patch=$patch delete=$delete firstmate=$firstmate" }
    "PATCH=$patch DELETE=$delete firstmate=$firstmate"
  }
}

$pass = @($rows | Where-Object status -eq 'PASS').Count
$skip = @($rows | Where-Object status -eq 'SKIP').Count
$fail = @($rows | Where-Object status -eq 'FAIL').Count
Write-Host "TOTAL E2E: $pass PASS / $skip SKIP / $fail FAIL / $($rows.Count) steps" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })

$receiptDir = Join-Path $root 'plans\reports'
New-Item -ItemType Directory -Force $receiptDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-ddTHHmmss'
$commit = try { (git -C $root rev-parse --short HEAD 2>$null).Trim() } catch { 'unknown' }
$receipt = [pscustomobject]@{ kind = 'total-e2e-test'; runAt = Get-Date -Format 'o'; commit = $commit; steps = $rows; pass = $pass; skip = $skip; fail = $fail; verdict = if ($fail -eq 0) { 'ALL-PASS' } else { 'FAILED' } }
$receiptPath = Join-Path $receiptDir ("total-e2e-test-{0}.json" -f $stamp)
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
Write-Host "receipt: $receiptPath"
if ($fail -gt 0) { exit 1 }
