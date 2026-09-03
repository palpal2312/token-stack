<#
.SYNOPSIS
    Token-Stack 2.0 Headroom Daemon Supervisor.
.DESCRIPTION
    Continuously monitors, launches, and auto-heals multi-instance Headroom proxies.
    Prevents orphaned processes and eliminates subshell termination crashes.
#>

[CmdletBinding()]
param(
    [switch]$Watch,
    [int]$IntervalSec = 15,
    [string]$TargetProfile = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot

. (Join-Path $RepoRoot "core\registry.ps1")

$headroomExe = Join-Path $env:USERPROFILE ".local\bin\headroom.exe"
if (-not (Test-Path -LiteralPath $headroomExe)) {
    throw "Headroom executable not found at $headroomExe"
}

function Ensure-HeadroomInstance {
    param(
        [string]$ProfileName,
        [pscustomobject]$Config
    )

    $port = $Config.headroom_port
    if (-not $port) { return }

    $readyzUrl = "http://127.0.0.1:$port/readyz"
    $isLive = $false
    try {
        $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($r -and $r.StatusCode -eq 200) { $isLive = $true }
    } catch {}

    if ($isLive) {
        return
    }

    Write-Host "[Supervisor] Reviving/Starting Headroom instance for '$ProfileName' (Port: $port, Upstream: $($Config.upstream))..." -ForegroundColor Yellow
    Ensure-ProfileDbDirectory $Config.db_path

    $argsList = @('proxy', '--port', $port.ToString(), '--anthropic-api-url', $Config.upstream)
    if ($Config.db_path) {
        $argsList += @('--memory-db-path', $Config.db_path)
    }

    Start-Process -WindowStyle Hidden -FilePath $headroomExe -ArgumentList $argsList

    # Brief check
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($r -and $r.StatusCode -eq 200) {
            Write-Host "[Supervisor] '$ProfileName' is now READY on port $port." -ForegroundColor Green
        }
    } catch {}
}

function Execute-SupervisorSweep {
    $reg = Get-TokenStackRegistry
    $profiles = $reg.profiles.PSObject.Properties

    foreach ($p in $profiles) {
        if ($TargetProfile -and $TargetProfile -ne "--all" -and $TargetProfile -ne $p.Name) {
            continue
        }
        Ensure-HeadroomInstance -ProfileName $p.Name -Config $p.Value
    }
}

if ($Watch) {
    Write-Host "[Supervisor] Starting continuous keep-alive loop (interval: ${IntervalSec}s)... Press Ctrl+C to stop." -ForegroundColor Cyan
    while ($true) {
        try {
            Execute-SupervisorSweep
        } catch {
            Write-Host "[Supervisor] Error during sweep: $($_.Exception.Message)" -ForegroundColor Red
        }
        Start-Sleep -Seconds $IntervalSec
    }
} else {
    Execute-SupervisorSweep
}
