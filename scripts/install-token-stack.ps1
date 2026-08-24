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

# --- Headroom port isolation ---
# Each profile MUST use its own headroom port.
# Upstream is read from the profile's EXISTING ANTHROPIC_BASE_URL before we redirect to headroom.

function Get-OriginalUpstream {
    param($Settings)
    $envProp = $Settings.PSObject.Properties['env']
    if ($envProp -and $envProp.Value) {
        $baseProp = $envProp.Value.PSObject.Properties['ANTHROPIC_BASE_URL']
        if ($baseProp -and $baseProp.Value) {
            $val = $baseProp.Value
            # Skip if already pointing to a headroom proxy (127.0.0.1:87xx)
            if ($val -notmatch 'http://127\.0\.0\.1:87\d\d') {
                return $val
            }
        }
    }
    return 'https://api.anthropic.com'
}

function Test-PortAvailable {
    param([int]$Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-UsedHeadroomPorts {
    param([string]$CurrentProfileName = '')
    $usedPorts = @()
    $envFiles = Get-ChildItem -Path $HOME -Filter '.env*' -File -ErrorAction SilentlyContinue
    foreach ($f in $envFiles) {
        if ($CurrentProfileName -and ($f.Name -match "\.env\.(claude-)?$([regex]::Escape($CurrentProfileName))$")) {
            continue
        }
        $content = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue
        foreach ($line in $content) {
            if ($line -match '^\s*HEADROOM_PORT\s*=\s*(\d+)') {
                $usedPorts += [int]$Matches[1]
            }
        }
    }
    return @($usedPorts | Select-Object -Unique)
}

function Get-NextFreePort {
    param(
        [string]$CurrentProfileName = '',
        [int]$StartPort = 8787,
        [int]$MaxPort = 9999
    )
    $used = Get-UsedHeadroomPorts -CurrentProfileName $CurrentProfileName
    for ($port = $StartPort; $port -le $MaxPort; $port++) {
        if ($used -notcontains $port -and (Test-PortAvailable $port)) {
            return $port
        }
    }
    throw "No available port found in range $StartPort - $MaxPort"
}

function Get-ProfileName {
    param([string]$ProfilePath)
    $dirName = Split-Path $ProfilePath -Leaf
    if ($dirName -match '^\.claude-(.+)$') { return $Matches[1] }
    if ($dirName -eq '.claude') { return 'claude' }
    return $dirName
}

# --- Main ---

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

# Headroom planning: read upstream + pick free port
$profileName = Get-ProfileName $profile
$envFilePath = Join-Path $HOME ".env.claude-$profileName"
if ($profileName -eq 'claude') { $envFilePath = Join-Path $HOME '.env.claude' }
$headroomPort = $null
$headroomUpstream = $null

if ($settingsExists) {
    $tempSettings = Get-JsonObject $settingsPath
    $headroomUpstream = Get-OriginalUpstream $tempSettings
    $headroomPort = Get-NextFreePort -CurrentProfileName $profileName -StartPort 8787 -MaxPort 9999
}

if (-not $Apply) {
    Write-Output "mode=DRY_RUN profile=$profile"
    Write-Output "source=$source"
    $planned | ForEach-Object { Write-Output "skill=$($_.Name) state=$($_.State)" }
    Write-Output "settings=$($settingsExists.ToString().ToLowerInvariant()) plugin_config=will_update_if_apply"
    Write-Output "headroom_port=$headroomPort upstream=$headroomUpstream env_file=$envFilePath"
    Write-Output 'apply=false; no changes made'
    exit 0
}

if (-not $settingsExists) { throw 'settings.json not found; start Claude Code once before applying' }
if (-not $PSCmdlet.ShouldProcess($profile, 'install token-stack skills, enable plugins, configure headroom')) { exit 0 }

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
        $srcSkill = Join-Path $source "skills\$name"
        $stagedPath = Join-Path $stagingRoot $name
        if (($planned | Where-Object { $_.Name -eq $name }).State -eq 'missing') {
            Copy-Item -LiteralPath $srcSkill -Destination $stagedPath -Recurse -Force -ErrorAction Stop
        }
    }

    Copy-Item -LiteralPath $settingsPath -Destination $settingsBackup -ErrorAction Stop
    $settings = Get-JsonObject $settingsPath
    Set-PluginEnabled $settings

    # --- Headroom configuration ---
    Ensure-ObjectProperty $settings 'env'
    $settings.env | Add-Member -Force -NotePropertyName 'ANTHROPIC_BASE_URL' -NotePropertyValue "http://127.0.0.1:$headroomPort"

    # Write .env file with headroom routing vars only (NO API keys!)
    $envContent = @(
        "ANTHROPIC_BASE_URL=$headroomUpstream"
        "HEADROOM_UPSTREAM=$headroomUpstream"
        "HEADROOM_PORT=$headroomPort"
    )
    [System.IO.File]::WriteAllLines($envFilePath, $envContent, [System.Text.UTF8Encoding]::new($false))

    # Copy and patch headroom-ensure.sh hook with profile-specific port
    $hooksDir = Join-Path $profile 'hooks'
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
    $hookSource = Join-Path $source 'scripts\headroom-ensure.sh'
    $hookDest = Join-Path $hooksDir 'headroom-ensure.sh'
    if (Test-Path -LiteralPath $hookSource) {
        $hookContent = [System.IO.File]::ReadAllText($hookSource, [System.Text.Encoding]::UTF8)
        $hookContent = $hookContent -replace 'HEADROOM_PORT:-\d+', "HEADROOM_PORT:-$headroomPort"
        [System.IO.File]::WriteAllText($hookDest, $hookContent, [System.Text.UTF8Encoding]::new($false))
    }

    # Register SessionStart hook (Git Bash to avoid Windows EFTYPE error)
    Ensure-ObjectProperty $settings 'hooks'
    $hookPathStr = ($hookDest -replace '\\', '/')
    $sessionStartHook = @{
        matcher = 'startup'
        hooks = @(
            @{
                type = 'command'
                command = 'C:/Program Files/Git/bin/bash.exe'
                args = @($hookPathStr)
                timeout = 120
            }
        )
    }
    # Preserve existing SessionStart hooks, append ours
    $existingHooks = @()
    $hooksProp = $settings.hooks.PSObject.Properties['SessionStart']
    if ($hooksProp -and $hooksProp.Value) {
        foreach ($h in $hooksProp.Value) {
            $isOurs = $false
            if ($h.hooks) {
                foreach ($inner in $h.hooks) {
                    if ($inner.args -and ($inner.args -join ' ') -match 'headroom-ensure') { $isOurs = $true }
                }
            }
            if (-not $isOurs) { $existingHooks += $h }
        }
    }
    $existingHooks += $sessionStartHook
    $settings.hooks | Add-Member -Force -NotePropertyName 'SessionStart' -NotePropertyValue $existingHooks

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
    Write-Output "applied=true profile=$profile skills=$($skillNames.Count) headroom_port=$headroomPort upstream=$headroomUpstream backup=created"
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

