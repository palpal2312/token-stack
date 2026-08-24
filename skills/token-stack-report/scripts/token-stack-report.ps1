[CmdletBinding()]
param([string]$ProfileDirectory, [switch]$Json)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ProfileDirectory) {
    if ($env:CLAUDE_CONFIG_DIR) { $ProfileDirectory = $env:CLAUDE_CONFIG_DIR }
    elseif ($env:CODEX_HOME) { $ProfileDirectory = $env:CODEX_HOME }
    elseif ($env:KIMI_CONFIG_DIR) { $ProfileDirectory = $env:KIMI_CONFIG_DIR }
    else {
        $isCodex = $false
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction SilentlyContinue
        if ($parent -and $parent.ParentProcessId) {
            $pproc = Get-CimInstance Win32_Process -Filter "ProcessId = $($parent.ParentProcessId)" -ErrorAction SilentlyContinue
            if ($pproc -and ($pproc.Name -match '(?i)codex' -or $pproc.CommandLine -match '(?i)codex')) {
                $isCodex = $true
            }
        }
        if ($isCodex -and (Test-Path (Join-Path $HOME '.codex'))) {
            $ProfileDirectory = Join-Path $HOME '.codex'
        } else {
            $ProfileDirectory = Join-Path $HOME '.claude'
        }
    }
}
$ProfileDirectory = [Environment]::ExpandEnvironmentVariables($ProfileDirectory)
$healthScript = Join-Path $PSScriptRoot '..\..\token-stack-health\scripts\token-stack-health.ps1'
$health = $null
try { $health = (& powershell -NoProfile -ExecutionPolicy Bypass -File $healthScript -ProfileDirectory $ProfileDirectory -SkipRuntimeProbes -Json | ConvertFrom-Json) } catch { }

function Get-Numbers {
    param($Object, [string[]]$Keys)
    function Visit($Value) {
        $sum = 0L; $count = 0
        if ($null -eq $Value) { return [pscustomobject]@{ Value = 0L; Count = 0 } }
        if ($Value -is [Array]) {
            foreach ($item in $Value) {
                $child = Visit $item
                $sum += $child.Value
                $count += $child.Count
            }
        } elseif ($Value -is [System.Collections.IDictionary] -or $Value -is [pscustomobject]) {
            foreach ($property in $Value.PSObject.Properties) {
                if ($Keys -contains $property.Name -and $property.Value -is [ValueType]) {
                    $number = 0L
                    if ([long]::TryParse([string]$property.Value, [ref]$number)) { $sum += $number; $count++ }
                } else {
                    $child = Visit $property.Value
                    $sum += $child.Value
                    $count += $child.Count
                }
            }
        }
        return [pscustomobject]@{ Value = $sum; Count = $count }
    }
    return (Visit $Object)
}

function Read-UsageTotals {
    $path = Join-Path $ProfileDirectory 'token-stack-usage.jsonl'
    $totals = [ordered]@{ turns = $null; input_tokens = $null; output_tokens = $null; cache_read_input_tokens = $null; cache_creation_input_tokens = $null }
    $validRecords = 0
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [pscustomobject]@{ Available = $false; Totals = [pscustomobject]$totals } }
    foreach ($line in Get-Content -LiteralPath $path) {
        try {
            $item = $line | ConvertFrom-Json
            $recordValid = $false
            foreach ($key in @($totals.Keys)) {
                $property = $item.PSObject.Properties[$key]
                if ($null -ne $property) {
                    $number = 0L
                    if ([long]::TryParse([string]$property.Value, [ref]$number) -and $number -ge 0) {
                        if ($null -eq $totals[$key]) { $totals[$key] = 0L }
                        $totals[$key] += $number
                        $recordValid = $true
                    }
                }
            }
            if ($recordValid) { $validRecords++ }
        } catch { }
    }
    return [pscustomobject]@{ Available = ($validRecords -gt 0); Totals = [pscustomobject]$totals }
}

function Get-HeadroomStats {
    param($BaseUrl)
    $safe = [ordered]@{ Available = $false; requests = $null; input_tokens = $null; output_tokens = $null; saved_tokens = $null }
    try {
        $uri = [Uri]$BaseUrl
        if (-not $uri.IsLoopback) { return [pscustomobject]$safe }
        $response = Invoke-WebRequest -Uri ([Uri]::new($uri, '/stats')) -UseBasicParsing -TimeoutSec 3
        $stats = $response.Content | ConvertFrom-Json
        foreach ($key in @('requests', 'input_tokens', 'output_tokens', 'saved_tokens', 'tokens_saved')) {
            $number = Get-Numbers $stats @($key)
            if ($number.Count -gt 0) { if ($key -eq 'tokens_saved') { $safe.saved_tokens = $number.Value } else { $safe[$key] = $number.Value } }
        }
        $safe.Available = $true
    } catch { }
    return [pscustomobject]$safe
}

$usage = Read-UsageTotals
$baseUrl = $null
try {
    $settings = Get-Content -LiteralPath (Join-Path $ProfileDirectory 'settings.json') -Raw | ConvertFrom-Json
    $baseUrl = $settings.env.ANTHROPIC_BASE_URL
    if (-not $baseUrl) { $baseUrl = $settings.env.OPENAI_BASE_URL }
} catch { }
if (-not $baseUrl) {
    $envPath = Join-Path $ProfileDirectory '.env'
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
        $lines = Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue
        foreach ($line in $lines) {
            if ($line -match '^\s*ANTHROPIC_BASE_URL\s*=\s*([^\s]+)') { $baseUrl = $Matches[1]; break }
            if ($line -match '^\s*OPENAI_BASE_URL\s*=\s*([^\s]+)') { $baseUrl = $Matches[1]; break }
            if ($line -match '^\s*HEADROOM_PORT\s*=\s*(\d+)') { $baseUrl = "http://127.0.0.1:$($Matches[1])"; break }
        }
    }
}
$headroom = Get-HeadroomStats $baseUrl
$report = [pscustomobject]@{
    profile = $ProfileDirectory
    rtk = [pscustomobject]@{ observed = 'UNKNOWN'; source = 'rtk gain counters not assumed' }
    headroom = $headroom
    claude_usage = [pscustomobject]@{ observed = $usage.Available; totals = $usage.Totals }
    ponytail_caveman = [pscustomobject]@{ observed = 'A/B baseline required'; savings = 'UNKNOWN' }
}
if ($Json) { $report | ConvertTo-Json -Depth 8 -Compress; exit 0 }
Write-Output "profile=$ProfileDirectory"
Write-Output "rtk savings=UNKNOWN (no provider billing claim)"
$savedTokens = if ($null -eq $headroom.saved_tokens) { 'UNKNOWN' } else { $headroom.saved_tokens }
$turns = if ($null -eq $usage.Totals.turns) { 'UNKNOWN' } else { $usage.Totals.turns }
$inputTokens = if ($null -eq $usage.Totals.input_tokens) { 'UNKNOWN' } else { $usage.Totals.input_tokens }
$outputTokens = if ($null -eq $usage.Totals.output_tokens) { 'UNKNOWN' } else { $usage.Totals.output_tokens }
Write-Output "headroom available=$($headroom.Available) saved_tokens=$savedTokens"
Write-Output "claude_usage observed=$($usage.Available) turns=$turns input=$inputTokens output=$outputTokens"
Write-Output 'ponytail+caveman savings=UNKNOWN (matched A/B baseline required)'

