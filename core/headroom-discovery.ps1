<#
.SYNOPSIS
    Live Headroom process and socket discovery engine.
.DESCRIPTION
    Scans the operating system for active Headroom proxy instances, extracts runtime
    ports and database arguments from process commandlines, tests loopback liveness,
    and probes `/readyz` endpoints.
#>

function Get-RunningHeadroomProcesses {
    [CmdletBinding()]
    param()

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and
                ($_.CommandLine -match 'headroom(\.exe)?.*proxy' -or $_.CommandLine -match 'proxy.*--port')
            }

        foreach ($p in $procs) {
            $cmd = $p.CommandLine
            $port = $null
            $dbPath = $null
            $upstream = $null

            if ($cmd -match '--port\s+(\d+)') {
                $port = [int]$Matches[1]
            }
            if ($cmd -match '--memory-db-path\s+([^\s]+)') {
                $dbPath = $Matches[1].Trim('"').Trim("'")
            }
            if ($cmd -match '--(anthropic|openai)-api-url\s+([^\s]+)') {
                $upstream = $Matches[2].Trim('"').Trim("'")
            }

            if ($port -gt 0) {
                $results.Add([PSCustomObject]@{
                    ProcessId   = $p.ProcessId
                    Port        = $port
                    DbPath      = $dbPath
                    Upstream    = $upstream
                    CommandLine = $cmd
                })
            }
        }
    } catch {
        # Fallback for non-CIM or restricted environments
    }

    return $results
}

function Get-ActiveHeadroomPorts {
    [CmdletBinding()]
    param(
        [int]$StartPort = 8787,
        [int]$EndPort = 9999
    )

    $procs = Get-RunningHeadroomProcesses
    $livePorts = [System.Collections.Generic.Dictionary[int, PSCustomObject]]::new()

    # 1. From discovered processes
    foreach ($p in $procs) {
        if (-not $livePorts.ContainsKey($p.Port)) {
            $livePorts[$p.Port] = [PSCustomObject]@{
                Port        = $p.Port
                Source      = "process"
                ProcessId   = $p.ProcessId
                DbPath      = $p.DbPath
                Upstream    = $p.Upstream
                IsReady     = $false
            }
        }
    }

    # 2. Probe liveness for each discovered port
    foreach ($port in $livePorts.Keys) {
        $readyUrl = "http://127.0.0.1:$port/readyz"
        try {
            $resp = Invoke-WebRequest -Uri $readyUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
                $livePorts[$port].IsReady = $true
            }
        } catch {
            $livePorts[$port].IsReady = $false
        }
    }

    # 3. Scan listening loopback ports in range that might be zombie or non-CIM headroom instances
    try {
        $ipGlobal = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
        $activeListeners = $ipGlobal.GetActiveTcpListeners()
        foreach ($ep in $activeListeners) {
            if ($ep.Port -ge $StartPort -and $ep.Port -le $EndPort -and ($ep.Address.ToString() -eq "127.0.0.1" -or $ep.Address.ToString() -eq "0.0.0.0")) {
                if (-not $livePorts.ContainsKey($ep.Port)) {
                    $readyUrl = "http://127.0.0.1:$($ep.Port)/readyz"
                    $isHeadroom = $false
                    try {
                        $resp = Invoke-WebRequest -Uri $readyUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
                        if ($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
                            $isHeadroom = $true
                        }
                    } catch {}

                    if ($isHeadroom) {
                        $livePorts[$ep.Port] = [PSCustomObject]@{
                            Port        = $ep.Port
                            Source      = "socket-listener"
                            ProcessId   = $null
                            DbPath      = $null
                            Upstream    = $null
                            IsReady     = $true
                        }
                    }
                }
            }
        }
    } catch {}

    return $livePorts.Values
}

if ($ExecutionContext.SessionState.Module) {
    Export-ModuleMember -Function Get-RunningHeadroomProcesses, Get-ActiveHeadroomPorts
}
