<#
.SYNOPSIS
    Token-Stack 2.0 Automated 3-Stage E2E Verification Pipeline.
.DESCRIPTION
    Validates Proxy Liveness, Upstream Authentication & Streaming without assumptions.
#>

[CmdletBinding()]
param(
    [string]$Profile = $null,
    [string]$RegistryPath = $null,
    [string]$ApiKey = $env:TOKEN_STACK_API_KEY,
    [switch]$AllowLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:VerifierFailures = 0
$script:VerifierAttempts = 0

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot

. (Join-Path $RepoRoot "core\registry.ps1")

function Test-ProfileE2E {
    param(
        [string]$ProfileName,
        [pscustomobject]$Config,
        [string]$InjectedApiKey
    )

    Write-Host ""
    Write-Host "----------------------------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "  VERIFYING PROFILE: $ProfileName" -ForegroundColor Cyan
    Write-Host "----------------------------------------------------------------------------------" -ForegroundColor Cyan

    $port = if ($Config.PSObject.Properties['headroom_port']) { $Config.headroom_port } else { 8787 }
    $upstream = if ($Config.PSObject.Properties['upstream']) { $Config.upstream } else { "http://127.0.0.1:9284" }
    $model = if ($Config.PSObject.Properties['model']) { $Config.model } else { "claude-sonnet-4-5-thinking" }

    # Stage 1: Proxy Liveness Probe
    Write-Host "[Stage 1/3] Probing Headroom Proxy (Port $port)..." -NoNewline
    $readyzUrl = "http://127.0.0.1:$port/readyz"
    $stage1Pass = $false
    try {
        $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            $stage1Pass = $true
            Write-Host " [PASS] (HTTP 200 OK)" -ForegroundColor Green
        } else {
            $script:VerifierFailures++
            Write-Host " [FAIL] (HTTP $($r.StatusCode))" -ForegroundColor Red
        }
    } catch {
        $script:VerifierFailures++
        Write-Host " [FAIL] (Connection Refused / Down)" -ForegroundColor Red
    }

    $apiKey = $InjectedApiKey

    if (-not $apiKey) {
        Write-Host "[Stage 2/3] Direct Upstream Probe: [SKIP] (No API key found in profile settings)" -ForegroundColor Yellow
        Write-Host "[Stage 3/3] Proxy Stream Probe:   [SKIP] (Requires valid API key)" -ForegroundColor Yellow
        return
    }

    $script:VerifierAttempts++

    # Stage 2: Direct Upstream Streaming Probe
    Write-Host "[Stage 2/3] Direct Upstream Probe ($upstream)..." -NoNewline
    $body = @{
        model = $model
        max_tokens = 5
        stream = $true
        messages = @(@{ role = "user"; content = "Ping" })
    } | ConvertTo-Json -Compress

    $headers = @{
        'x-api-key' = $apiKey
        'anthropic-version' = '2023-06-01'
        'Content-Type' = 'application/json'
    }

    $directUrl = "$upstream/v1/messages"
    $stage2Pass = $false
    try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $resp = Invoke-WebRequest -Uri $directUrl -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 15
        $stopwatch.Stop()
        if ($resp.StatusCode -eq 200) {
            $stage2Pass = $true
            Write-Host " [PASS] ($($stopwatch.ElapsedMilliseconds)ms)" -ForegroundColor Green
        } else {
            $script:VerifierFailures++
            Write-Host " [FAIL] (HTTP $($resp.StatusCode))" -ForegroundColor Red
        }
    } catch {
        $script:VerifierFailures++
        Write-Host " [FAIL]" -ForegroundColor Red
        if ($_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $errContent = $reader.ReadToEnd()
                if ($errContent -match 'Throttling\.AllocationQuota|quota') {
                    Write-Host "        -> DIAGNOSIS: Upstream Account Quota Exhausted!" -ForegroundColor Red
                } elseif ($errContent -match 'model') {
                    Write-Host "        -> DIAGNOSIS: Model name '$model' rejected by upstream!" -ForegroundColor Red
                } else {
                    Write-Host "        -> Response body redacted." -ForegroundColor Gray
                }
            } catch {}
        } else {
            Write-Host "        -> Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    # Stage 3: Proxy Stream Probe
    Write-Host "[Stage 3/3] Proxy Stream Probe (http://127.0.0.1:$port)..." -NoNewline
    if (-not $stage1Pass) {
        Write-Host " [SKIP] (Proxy port is down)" -ForegroundColor Yellow
        return
    }

    $proxyUrl = "http://127.0.0.1:$port/v1/messages"
    try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $resp = Invoke-WebRequest -Uri $proxyUrl -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 20
        $stopwatch.Stop()
        if ($resp.StatusCode -eq 200 -and $resp.Content -match 'event:\s*message_start') {
            Write-Host " [PASS] (Streaming verified in $($stopwatch.ElapsedMilliseconds)ms)" -ForegroundColor Green
            Write-Host "RESULT: Profile '$ProfileName' is 100% OPERATIONAL." -ForegroundColor Green
        } else {
            $script:VerifierFailures++
            Write-Host " [WARN] (HTTP $($resp.StatusCode) but unexpected stream format)" -ForegroundColor Yellow
        }
    } catch {
        $script:VerifierFailures++
        Write-Host " [FAIL] ($($_.Exception.Message))" -ForegroundColor Red
    }
}

if (-not $AllowLive) {
    Write-Host "RESULT: SKIP (live verification requires -AllowLive)." -ForegroundColor Yellow
    exit 0
}

$reg = Get-TokenStackRegistry -Path $RegistryPath
$profiles = $reg.profiles.PSObject.Properties

foreach ($p in $profiles) {
    if ($Profile -and $Profile -ne "--all" -and $Profile -ne $p.Name) {
        continue
    }
    Test-ProfileE2E -ProfileName $p.Name -Config $p.Value -InjectedApiKey $ApiKey
}
Write-Host ""
if ($script:VerifierAttempts -eq 0) {
    Write-Host "RESULT: SKIP (no credential supplied for live verification)." -ForegroundColor Yellow
    exit 0
}
if ($script:VerifierFailures -gt 0) {
    Write-Host "RESULT: FAIL ($($script:VerifierFailures) verifier check(s) failed)." -ForegroundColor Red
    exit 1
}
Write-Host "RESULT: PASS (all attempted verifier checks passed)." -ForegroundColor Green
