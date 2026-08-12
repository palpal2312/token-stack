$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('token-stack-health-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $root 'plugins') | Out-Null
$settings = @{
    enabledPlugins = @{ 'ponytail@ponytail' = $true; 'caveman@caveman' = $false }
    env = @{ ANTHROPIC_BASE_URL = 'http://127.0.0.1:9' }
} | ConvertTo-Json -Depth 5
$manifest = @{ plugins = @{
    'ponytail@ponytail' = @(@{ installPath = $root })
    'caveman@caveman' = @(@{ installPath = $root })
} } | ConvertTo-Json -Depth 5
Set-Content -LiteralPath (Join-Path $root 'settings.json') -Value $settings
Set-Content -LiteralPath (Join-Path $root 'plugins\installed_plugins.json') -Value $manifest
$script = Join-Path $PSScriptRoot '..\scripts\token-stack-health.ps1'
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -ProfileDirectory $root -SkipRuntimeProbes -Json
if ($LASTEXITCODE -ne 0) { throw 'health checker failed' }
$result = $output | ConvertFrom-Json
if ($result.components.Count -ne 6) { throw 'expected harness, model, and four layer rows' }
$ponytail = $result.components | Where-Object Name -eq 'ponytail'
$caveman = $result.components | Where-Object Name -eq 'caveman'
if ($ponytail.Status -ne 'OK') { throw 'ponytail fixture should be OK' }
if ($caveman.Status -ne 'WARN') { throw 'caveman fixture should be WARN' }
$headroom = $result.components | Where-Object Name -eq 'headroom'
if ($headroom.Status -ne 'UNKNOWN') { throw 'skipped headroom probe should be UNKNOWN' }
if (($output -join '') -match 'ANTHROPIC_BASE_URL|127\.0\.0\.1:9') { throw 'health output leaked route' }
Remove-Item -LiteralPath $root -Recurse -Force
'PASS token-stack-health fixture'
