param(
  [string]$ConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }),
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$ConfigDir = [IO.Path]::GetFullPath($ConfigDir)
$settingsPath = Join-Path $ConfigDir 'settings.json'
$sourceHook = Join-Path $PSScriptRoot 'token-stack-usage.cjs'
$targetHook = Join-Path $ConfigDir 'hooks/token-stack-usage.cjs'

if (-not (Test-Path $settingsPath)) { throw "settings.json not found: $settingsPath" }
if (-not (Test-Path $sourceHook)) { throw "Counter script not found: $sourceHook" }

$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
$hooksDir = Split-Path $targetHook -Parent
if (-not $settings.hooks) {
  $settings | Add-Member -MemberType NoteProperty -Name hooks -Value ([pscustomobject]@{})
}
if (-not (Test-Path $hooksDir)) {
  if ($WhatIf) { Write-Output "Would create $hooksDir" } else { New-Item -ItemType Directory -Path $hooksDir | Out-Null }
}

if ($WhatIf) {
  Write-Output "Would copy $sourceHook to $targetHook"
} else {
  Copy-Item $sourceHook $targetHook -Force
}

$stopHooks = if ($settings.hooks.PSObject.Properties['Stop'] -and $settings.hooks.Stop) { @($settings.hooks.Stop) } else { @() }
$alreadyRegistered = $stopHooks | ForEach-Object { @($_.hooks) } | Where-Object {
  $_.args -contains 'C:/Users/ADMIN/.claude-sub2api/hooks/token-stack-usage.cjs' -or
  $_.args -contains $targetHook.Replace('\', '/')
}

if (-not $alreadyRegistered) {
  $entry = [pscustomobject]@{
    type = 'command'
    command = 'C:\Program Files\nodejs\node.exe'
    args = @($targetHook.Replace('\', '/'))
    timeout = 10
    statusMessage = 'Recording token-stack usage'
  }
  if ($stopHooks.Count -eq 0) {
    $settings.hooks | Add-Member -MemberType NoteProperty -Name Stop -Value @([pscustomobject]@{ matcher = '*'; hooks = @($entry) }) -Force
  } else {
    $existing = if ($stopHooks[0].hooks) { @($stopHooks[0].hooks) } else { @() }
    $stopHooks[0].hooks = $existing + $entry
    $settings.hooks.Stop = $stopHooks
  }
}

if ($WhatIf) {
  Write-Output "Would register Stop hook in $settingsPath"
  exit 0
}

$settings | ConvertTo-Json -Depth 50 | Set-Content $settingsPath -Encoding utf8
Write-Output "Usage counter installed: $targetHook"
Write-Output "Restart Claude Code to reload hooks."

