[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ProfileDirectory,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ProfileDirectory) {
    $ProfileDirectory = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
}
$ProfileDirectory = [Environment]::ExpandEnvironmentVariables($ProfileDirectory)
$settingsPath = Join-Path $ProfileDirectory 'settings.json'
$actions = @(
    'install marketplace plugins: caveman, ponytail'
    'enable caveman@caveman and ponytail@ponytail in settings.json'
    'verify RTK shim and binary; install manually if missing'
    'Headroom: skipped; use a dedicated agent'
)
if (-not (Get-Command rtk -ErrorAction SilentlyContinue)) {
    $actions += 'MANUAL: install RTK using its official installer'
}

if (-not $Apply) {
    Write-Output "mode=DRY_RUN profile=$ProfileDirectory"
    $actions | ForEach-Object { Write-Output "- $_" }
    Write-Output 'apply=false; no changes made'
    exit 0
}

if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { throw 'settings.json not found for profile' }
if (-not $PSCmdlet.ShouldProcess($ProfileDirectory, 'configure caveman and ponytail')) { exit 0 }

function Invoke-CheckedNative {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
}

$oldConfigDir = $env:CLAUDE_CONFIG_DIR
$backupPath = "$settingsPath.$([Guid]::NewGuid().ToString('N')).bak"
$tempPath = "$settingsPath.$([Guid]::NewGuid().ToString('N')).tmp"
try {
    Copy-Item -LiteralPath $settingsPath -Destination $backupPath -ErrorAction Stop
    $env:CLAUDE_CONFIG_DIR = $ProfileDirectory
    Invoke-CheckedNative 'claude' @('plugin', 'marketplace', 'add', 'JuliusBrussee/caveman')
    Invoke-CheckedNative 'claude' @('plugin', 'marketplace', 'add', 'DietrichGebert/ponytail')
    Invoke-CheckedNative 'claude' @('plugin', 'install', 'caveman@caveman')
    Invoke-CheckedNative 'claude' @('plugin', 'install', 'ponytail@ponytail')

    $settings = [System.IO.File]::ReadAllText($settingsPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $enabled = $settings.PSObject.Properties['enabledPlugins']
    if ($null -eq $enabled -or $null -eq $enabled.Value) {
        $settings | Add-Member -NotePropertyName enabledPlugins -NotePropertyValue ([pscustomobject]@{})
    }
    $settings.enabledPlugins | Add-Member -Force -NotePropertyName 'caveman@caveman' -NotePropertyValue $true
    $settings.enabledPlugins | Add-Member -Force -NotePropertyName 'ponytail@ponytail' -NotePropertyValue $true
    $json = $settings | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($tempPath, $json, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Replace($tempPath, $settingsPath, $backupPath, $true)
    Write-Output "applied=true profile=$ProfileDirectory backup=created headroom=skipped"
} catch {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    throw
} finally {
    if ($null -eq $oldConfigDir) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    else { $env:CLAUDE_CONFIG_DIR = $oldConfigDir }
}
