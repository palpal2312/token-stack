param(
  [string]$ConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' })
)

$ErrorActionPreference = 'Stop'
$ConfigDir = [IO.Path]::GetFullPath($ConfigDir)
$settingsPath = Join-Path $ConfigDir 'settings.json'
$ledgerPath = Join-Path $ConfigDir 'token-stack-usage.jsonl'
$counterPath = Join-Path $ConfigDir 'hooks/token-stack-usage.cjs'

$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
$rtkShow = try { & "$env:LOCALAPPDATA\rtk\rtk.exe" init --show 2>&1 | Out-String } catch { '' }
$counter = if (Test-Path $counterPath) { 'installed' } else { 'missing' }
$summary = if (Test-Path $counterPath) {
  node $counterPath --summary | ConvertFrom-Json
} else { $null }

[pscustomobject]@{
  ConfigDir = $ConfigDir
  HeadroomBaseUrl = $settings.env.ANTHROPIC_BASE_URL
  CavemanEnabled = [bool]$settings.enabledPlugins.'caveman@caveman'
  PonytailEnabled = [bool]$settings.enabledPlugins.'ponytail@ponytail'
  UsageCounter = $counter
  UsageLedger = if (Test-Path $ledgerPath) { $ledgerPath } else { 'not-created-yet' }
  UsageSummary = $summary
  RtkHookConfigured = $rtkShow -match 'Hook: rtk hook claude'
} | ConvertTo-Json -Depth 8
