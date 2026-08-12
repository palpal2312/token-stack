[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ProfileDirectory,
    [string]$SourceRoot,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillNames = @('token-stack', 'token-stack-health', 'token-stack-setup', 'token-stack-report')

function Resolve-Directory {
    param([string]$Path, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label is required" }
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    $resolved = Resolve-Path -LiteralPath $expanded -ErrorAction Stop
    $item = Get-Item -LiteralPath $resolved.Path -ErrorAction Stop
    if (-not $item.PSIsContainer) { throw "$Label must be a directory" }
    return $item.FullName
}

function Get-DefaultSourceRoot {
    return (Resolve-Directory (Join-Path $PSScriptRoot '..') 'SourceRoot')
}

function Get-DefaultProfileDirectory {
    if ($env:CLAUDE_CONFIG_DIR) { return $env:CLAUDE_CONFIG_DIR }
    return (Join-Path $HOME '.claude')
}

function Assert-SourceTree {
    param([string]$Root)
    foreach ($name in $skillNames) {
        $skillPath = Join-Path $Root "skills\$name"
        $skillFile = Join-Path $skillPath 'SKILL.md'
        if (-not (Test-Path -LiteralPath $skillFile -PathType Leaf)) {
            throw "Missing skill file: skills\$name\SKILL.md"
        }
    }
}

function Get-JsonObject {
    param([string]$Path)
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $value = $text | ConvertFrom-Json
    if ($null -eq $value -or $value -is [Array] -or $value -is [ValueType]) {
        throw 'settings.json root must be a JSON object'
    }
    return $value
}

function Ensure-ObjectProperty {
    param($Object, [string]$Name)
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{})
        return
    }
    if ($null -eq $property.Value) {
        $Object | Add-Member -Force -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{})
        return
    }
    if ($property.Value -is [Array] -or $property.Value -is [ValueType]) {
        throw "settings.$Name must be a JSON object"
    }
}

function Set-PluginEnabled {
    param($Settings)
    Ensure-ObjectProperty $Settings 'enabledPlugins'
    $Settings.enabledPlugins | Add-Member -Force -NotePropertyName 'caveman@caveman' -NotePropertyValue $true
    $Settings.enabledPlugins | Add-Member -Force -NotePropertyName 'ponytail@ponytail' -NotePropertyValue $true
}

function Get-ExpectedSkillId {
    param([string]$DirectoryName)
    if ($DirectoryName -eq 'token-stack') { return 'token-stack' }
    return "token-stack:$($DirectoryName.Substring('token-stack-'.Length))"
}

function Get-SkillState {
    param([string]$Destination, [string]$Name)
    if (-not (Test-Path -LiteralPath $Destination)) { return 'missing' }
    $item = Get-Item -LiteralPath $Destination -ErrorAction Stop
    if (-not $item.PSIsContainer) { throw "Skill destination is not a directory: skills\$Name" }
    $skillFile = Join-Path $Destination 'SKILL.md'
    if (-not (Test-Path -LiteralPath $skillFile -PathType Leaf)) { throw "Skill destination conflicts: skills\$Name" }
    $content = [System.IO.File]::ReadAllText($skillFile, [System.Text.Encoding]::UTF8)
    $expectedId = Get-ExpectedSkillId $Name
    if ($content -notmatch "(?m)^name:\s*$([regex]::Escape($expectedId))(?:$|\s)") {
        throw "Skill destination contains a different skill: skills\$Name"
    }
    return 'present'
}

$sourcePath = if ($SourceRoot) { $SourceRoot } else { Get-DefaultSourceRoot }
$profilePath = if ($ProfileDirectory) { $ProfileDirectory } else { Get-DefaultProfileDirectory }
$source = Resolve-Directory $sourcePath 'SourceRoot'
$profile = Resolve-Directory $profilePath 'ProfileDirectory'
Assert-SourceTree $source

$skillsDirectory = Join-Path $profile 'skills'
$settingsPath = Join-Path $profile 'settings.json'
$planned = @()
foreach ($name in $skillNames) {
    $destination = Join-Path $skillsDirectory $name
    $state = if (Test-Path -LiteralPath $skillsDirectory) { Get-SkillState $destination $name } else { 'missing' }
    $planned += [pscustomobject]@{ Name = $name; State = $state }
}
$settingsExists = Test-Path -LiteralPath $settingsPath -PathType Leaf

if (-not $Apply) {
    Write-Output "mode=DRY_RUN profile=$profile"
    Write-Output "source=$source"
    $planned | ForEach-Object { Write-Output "skill=$($_.Name) state=$($_.State)" }
    Write-Output "settings=$($settingsExists.ToString().ToLowerInvariant()) plugin_config=will_update_if_apply"
    Write-Output 'headroom=SKIPPED; use dedicated Headroom agent'
    Write-Output 'apply=false; no changes made'
    exit 0
}

if (-not $settingsExists) { throw 'settings.json not found; start Claude Code once before applying' }
if (-not $PSCmdlet.ShouldProcess($profile, 'install token-stack skills and enable plugins')) { exit 0 }

$runId = [Guid]::NewGuid().ToString('N')
$stagingRoot = Join-Path $skillsDirectory ".token-stack-install-$runId"
$settingsBackup = "$settingsPath.$runId.bak"
$settingsTemp = "$settingsPath.$runId.tmp"
$createdDestinations = [System.Collections.Generic.List[string]]::new()
$settingsReplaced = $false

try {
    New-Item -ItemType Directory -Path $skillsDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    foreach ($name in $skillNames) {
        $sourcePath = Join-Path $source "skills\$name"
        $stagedPath = Join-Path $stagingRoot $name
        if (($planned | Where-Object { $_.Name -eq $name }).State -eq 'missing') {
            Copy-Item -LiteralPath $sourcePath -Destination $stagedPath -Recurse -Force -ErrorAction Stop
        }
    }

    Copy-Item -LiteralPath $settingsPath -Destination $settingsBackup -ErrorAction Stop
    $settings = Get-JsonObject $settingsPath
    Set-PluginEnabled $settings
    $json = $settings | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($settingsTemp, $json, [System.Text.UTF8Encoding]::new($false))

    foreach ($name in $skillNames) {
        $destination = Join-Path $skillsDirectory $name
        $state = ($planned | Where-Object { $_.Name -eq $name }).State
        if ($state -eq 'missing') {
            Move-Item -LiteralPath (Join-Path $stagingRoot $name) -Destination $destination -ErrorAction Stop
            $createdDestinations.Add($destination)
        }
    }

    [System.IO.File]::Replace($settingsTemp, $settingsPath, $settingsBackup, $true)
    $settingsReplaced = $true
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output "applied=true profile=$profile skills=$($skillNames.Count) headroom=skipped backup=created"
} catch {
    if (Test-Path -LiteralPath $settingsTemp) { Remove-Item -LiteralPath $settingsTemp -Force -ErrorAction SilentlyContinue }
    if ($settingsReplaced -and (Test-Path -LiteralPath $settingsBackup)) {
        Copy-Item -LiteralPath $settingsBackup -Destination $settingsPath -Force -ErrorAction SilentlyContinue
    }
    foreach ($destination in $createdDestinations) {
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
    throw
}
