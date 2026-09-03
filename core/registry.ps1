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

function Export-HeadroomPortNote {
    [CmdletBinding()]
    param(
        [string]$Path,
        [string]$OutputPath
    )

    $reg = Get-TokenStackRegistry -Path $Path
    $resolvedRepo = if ($reg.PSObject.Properties['repo_root']) { $reg.repo_root } else { (Split-Path -Parent (Split-Path -Parent (Get-RegistryPath $Path))) }
    if (-not $OutputPath) {
        $OutputPath = Join-Path $resolvedRepo "docs\headroom-ports.md"
    }

    $outDir = Split-Path -Parent $OutputPath
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }

    $discoveryScript = Join-Path $resolvedRepo "core\headroom-discovery.ps1"
    $liveMap = @{}
    if (Test-Path -LiteralPath $discoveryScript) {
        . $discoveryScript
        $live = Get-ActiveHeadroomPorts
        foreach ($l in $live) {
            $liveMap[$l.Port] = $l
        }
    }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("# Token-Stack Headroom Port & Agent Registry")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("> Tự động sinh bởi Token-Stack Registry Engine. Single Source of Truth cho multi-instance Headroom.")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("| Profile | Agent Type | Port | Upstream | Live Process | Status | DB Path |")
    [void]$sb.AppendLine("|:---|:---:|:---:|:---|:---:|:---:|:---|")

    $profiles = $reg.profiles.PSObject.Properties
    foreach ($p in $profiles) {
        $cfg = $p.Value
        $port = $cfg.headroom_port
        $isLive = $liveMap.ContainsKey($port)
        $isReady = if ($isLive) { $liveMap[$port].IsReady } else { $false }
        $liveIcon = if ($isReady) { "Ready (PID: " + $liveMap[$port].ProcessId + ")" } elseif ($isLive) { "Starting" } else { "Offline (On Restart)" }
        $agentType = if ($cfg.type) { $cfg.type } else { "claude" }
        $upstreamUrl = if ($cfg.upstream) { $cfg.upstream } else { "" }
        $db = if ($cfg.db_path) { $cfg.db_path } else { "(default)" }

        $statusStr = if ($isReady) { 'ACTIVE' } else { 'STAGED' }
        $line = [string]::Format("| **{0}** | `{1}` | `{2}` | `{3}` | {4} | {5} | `{6}` |", $p.Name, $agentType, $port, $upstreamUrl, $liveIcon, $statusStr, $db)
        [void]$sb.AppendLine($line)
    }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("### Cổng phát hiện ngoài Registry:")
    $unreg = 0
    foreach ($lp in $liveMap.Values) {
        $found = $false
        foreach ($p in $profiles) {
            if ($p.Value.headroom_port -eq $lp.Port) { $found = $true; break }
        }
        if (-not $found) {
            $unreg++
            [void]$sb.AppendLine("- Port `$($lp.Port)`: PID $($lp.ProcessId), Ready: $($lp.IsReady)")
        }
    }
    if ($unreg -eq 0) {
        [void]$sb.AppendLine("_Không có cổng lạ nào ngoài danh mục đăng ký._")
    }

    [System.IO.File]::WriteAllText($OutputPath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
    return $OutputPath
}

if ($ExecutionContext.SessionState.Module) {
    Export-ModuleMember -Function Get-TokenStackRegistry, Save-TokenStackRegistry, Get-TokenStackProfile, Set-TokenStackProfile, Remove-TokenStackProfile, Ensure-ProfileDbDirectory, Export-HeadroomPortNote
}
