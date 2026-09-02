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
        [int[]]$ReservedPorts = @()
    )

    for ($p = $StartPort; $p -le $EndPort; $p++) {
        if ($ReservedPorts -contains $p) {
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
