<#
.SYNOPSIS
    Centralized Profile & Port Registry for Token-Stack 2.0.
.DESCRIPTION
    Provides single source of truth for agent profiles, Headroom ports, upstreams,
    and memory DB paths.
#>

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$DefaultRegistryPath = Join-Path $RepoRoot "token-stack.registry.json"

function Get-RegistryPath {
    param([string]$Path)
    if ($Path) { return $Path }
    if ($env:TOKEN_STACK_REGISTRY) { return $env:TOKEN_STACK_REGISTRY }
    return $DefaultRegistryPath
}

function Get-TokenStackRegistry {
    [CmdletBinding()]
    param([string]$Path)
    
    $resolvedPath = Get-RegistryPath $Path
    if (-not (Test-Path -LiteralPath $resolvedPath)) {
        return [pscustomobject]@{
            version = "2.0.0"
            sub2api_upstream = "http://127.0.0.1:9284"
            profiles = [pscustomobject]@{}
        }
    }

    $json = [System.IO.File]::ReadAllText($resolvedPath, [System.Text.Encoding]::UTF8)
    return ($json | ConvertFrom-Json)
}

function Save-TokenStackRegistry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $Registry,
        [string]$Path
    )

    $resolvedPath = Get-RegistryPath $Path
    $parentDir = Split-Path -Parent $resolvedPath
    if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    $json = $Registry | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($resolvedPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-TokenStackProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$Path
    )

    $reg = Get-TokenStackRegistry -Path $Path
    if ($reg.profiles.PSObject.Properties[$Name]) {
        return $reg.profiles.PSObject.Properties[$Name].Value
    }
    return $null
}

function Set-TokenStackProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [hashtable]$Config,
        [string]$Path
    )

    $reg = Get-TokenStackRegistry -Path $Path
    $psobj = [pscustomobject]$Config
    $reg.profiles | Add-Member -Force -NotePropertyName $Name -NotePropertyValue $psobj
    Save-TokenStackRegistry -Registry $reg -Path $Path
}

function Remove-TokenStackProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$Path
    )

    $reg = Get-TokenStackRegistry -Path $Path
    if ($reg.profiles.PSObject.Properties[$Name]) {
        $reg.profiles.PSObject.Properties.Remove($Name)
        Save-TokenStackRegistry -Registry $reg -Path $Path
        return $true
    }
    return $false
}

function Ensure-ProfileDbDirectory {
    [CmdletBinding()]
    param([string]$DbPath)

    if (-not $DbPath) { return }
    $dir = Split-Path -Parent $DbPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

if ($ExecutionContext.SessionState.Module) {
    Export-ModuleMember -Function Get-TokenStackRegistry, Save-TokenStackRegistry, Get-TokenStackProfile, Set-TokenStackProfile, Remove-TokenStackProfile, Ensure-ProfileDbDirectory
}
