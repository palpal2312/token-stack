[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,

    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [string]$RegistryPath = '',

    [switch]$AllowLive,

    [string]$ReceiptPath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$verifierScript = Join-Path $repoRoot 'core\verifier.ps1'

Write-Host "=== Token-Stack Live Provider Certification Gate ==="

if (-not $AllowLive) {
    Write-Error "PREFLIGHT REFUSAL: Live certification requires explicit -AllowLive switch."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Error "PREFLIGHT REFUSAL: Missing required ApiKey parameter."
    exit 1
}

# Resolve profile from registry
. (Join-Path $repoRoot 'core\registry.ps1')
$reg = Get-TokenStackRegistry -Path $RegistryPath
if (-not $reg.profiles.PSObject.Properties[$Profile]) {
    Write-Error "PREFLIGHT REFUSAL: Named profile '$Profile' not found in registry."
    exit 1
}

$pConfig = $reg.profiles.PSObject.Properties[$Profile].Value
$upstream = if ($pConfig.PSObject.Properties['upstream']) { $pConfig.upstream } else { 'https://api.anthropic.com' }

# Host allowlist enforcement
$uri = [System.Uri]::new($upstream)
$hostName = $uri.Host.ToLower()
$allowedHosts = @('api.anthropic.com', 'api.kimi.com', '127.0.0.1', 'localhost')
$isAllowed = ($allowedHosts -contains $hostName) -or ($hostName.EndsWith('.aliyuncs.com'))

if (-not $isAllowed) {
    Write-Error "PREFLIGHT REFUSAL: Host '$hostName' is not on the approved provider allowlist."
    exit 1
}

Write-Host "Profile:  $Profile"
Write-Host "Upstream: $hostName"
Write-Host "Budget:   Max 2 requests | Max 10 output tokens | Max USD 0.02"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$verifierArgs = @('-File', $verifierScript, '-Profile', $Profile, '-ApiKey', $ApiKey, '-AllowLive')
if ($RegistryPath) {
    $verifierArgs += @('-RegistryPath', $RegistryPath)
}

& powershell -NoProfile -ExecutionPolicy Bypass @verifierArgs
$exitCode = $LASTEXITCODE
$sw.Stop()

# Emit certification receipt
if (-not $ReceiptPath) {
    $ReceiptPath = Join-Path $repoRoot "reports\live-certification-$Profile-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).json"
}

$receiptDir = Split-Path -Parent $ReceiptPath
if ($receiptDir -and -not (Test-Path -LiteralPath $receiptDir)) {
    New-Item -ItemType Directory -Path $receiptDir -Force | Out-Null
}

$keySha256 = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ApiKey))).Replace('-', '').ToLower().Substring(0, 16)

$receipt = @{
    timestamp = [DateTime]::UtcNow.ToString('o')
    profile = $Profile
    upstream_host = $hostName
    credential_fingerprint = "sha256:$keySha256..."
    duration_ms = $sw.ElapsedMilliseconds
    status = if ($exitCode -eq 0) { "CERTIFIED" } else { "REJECTED" }
    exit_code = $exitCode
    constraints = @{
        max_requests = 2
        max_tokens_per_req = 5
        max_estimated_cost_usd = 0.02
    }
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText($ReceiptPath, $receipt, [System.Text.UTF8Encoding]::new($false))
Write-Host "`nCertification receipt written to: $ReceiptPath" -ForegroundColor Cyan

if ($exitCode -ne 0) {
    Write-Error "Live provider certification failed with exit code $exitCode."
    exit $exitCode
}

Write-Host "LIVE PROVIDER CERTIFICATION: SUCCESS" -ForegroundColor Green
exit 0
