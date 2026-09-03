<#
.SYNOPSIS
    Dynamic port allocation and socket probing for Token-Stack proxies.
.DESCRIPTION
    Guarantees unique port reservation across multiple agent profiles and ensures
    local TCP socket availability before binding.
#>

function Test-TcpPortFree {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Find-FreeHeadroomPort {
    [CmdletBinding()]
    param(
        [int]$StartPort = 8787,
        [int]$EndPort = 9999,
        [int[]]$ReservedPorts = @(),
        [switch]$IncludeRunningProcesses
    )

    $allReserved = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($r in $ReservedPorts) { [void]$allReserved.Add($r) }

    if ($IncludeRunningProcesses) {
        $scriptDir = $null
        try {
            if ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
                $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
            }
        } catch {}
        if (-not $scriptDir -and $PSScriptRoot) { $scriptDir = $PSScriptRoot }
        if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
        $discoveryScript = Join-Path $scriptDir "headroom-discovery.ps1"
        if (-not (Test-Path -LiteralPath $discoveryScript)) {
            $discoveryScript = Join-Path $scriptDir "core\headroom-discovery.ps1"
        }
        if (Test-Path -LiteralPath $discoveryScript) {
            . $discoveryScript
            $running = Get-ActiveHeadroomPorts -StartPort $StartPort -EndPort $EndPort
            foreach ($rp in $running) {
                [void]$allReserved.Add($rp.Port)
            }
        }
    }

    for ($p = $StartPort; $p -le $EndPort; $p++) {
        if ($allReserved.Contains($p)) {
            continue
        }
        if (Test-TcpPortFree -Port $p) {
            return $p
        }
    }

    throw "No free TCP port found in range $StartPort-$EndPort"
}

if ($ExecutionContext.SessionState.Module) {
    Export-ModuleMember -Function Test-TcpPortFree, Find-FreeHeadroomPort
}
