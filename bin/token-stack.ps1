<#
.SYNOPSIS
    Token-Stack Unified CLI Entrypoint.
.DESCRIPTION
    Command-line orchestrator for Token-Stack 2.0 (profiles, daemons, diagnostics, verification).
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = "status",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CandidateRoots = @(
    (Split-Path -Parent $ScriptRoot),
    "C:\Users\ADMIN\Documents\token-stack",
    (Join-Path $env:USERPROFILE "Documents\token-stack")
)
$RepoRoot = $null
foreach ($c in $CandidateRoots) {
    if ($c -and (Test-Path -LiteralPath (Join-Path $c "core\registry.ps1"))) {
        $RepoRoot = $c
        break
    }
}
if (-not $RepoRoot) {
    throw "Token-Stack repository root not found."
}

# Dot-source core modules
. (Join-Path $RepoRoot "core\registry.ps1")
. (Join-Path $RepoRoot "core\port-allocator.ps1")

function Show-Help {
    Write-Host @"
Token-Stack 3.2 CLI - 14-Layer Master Token & Context Engine

Usage:
  token-stack <command> [arguments]

Commands:
  status                   Display live table of all profiles, ports, upstream & health
  setup [-Apply]           Run automated 14-layer setup and component configuration
  doctor                   Run full 14-layer health inspection and diagnostic probes
  up [<name>|--all]        Start Headroom proxy daemon for profile(s)
  down [<name>|--all]      Stop Headroom proxy daemon for profile(s)
  profile list             List registered agent profiles
  profile add <name>       Register a new profile (auto-allocates free port and DB path)
  profile remove <name>    Unregister an existing profile
  verify [<name>]          Run automated 3-stage E2E validation pipeline
  test                     Run all unit & integration tests across the modular layers
  bench [args]             Launch interactive 14-layer Benchmark TUI
  data profile <file>      Profile CSV/TSV into a compact Data Contract (<100 tokens)
  quant tearsheet <file>   Collapse thousands of trade log lines into Quant Tear-Sheet
  cache [stats|clear]      Inspect or clear Layer -1 Zero-Token Semantic Cache
  skill route <prompt>     Route intent to Top-K skills (Anti-Skill-Shadowing, -98% bloat)
  help                     Show this help message
"@
}

function Invoke-Status {
    $reg = Get-TokenStackRegistry
    $profiles = $reg.profiles.PSObject.Properties

    Write-Host ""
    Write-Host "==========================================================================================" -ForegroundColor Cyan
    Write-Host "                           TOKEN-STACK LIVE PROFILE STATUS                                " -ForegroundColor Cyan
    Write-Host "==========================================================================================" -ForegroundColor Cyan

    $rows = @()
    foreach ($p in $profiles) {
        $name = $p.Name
        $val = $p.Value
        $port = $val.headroom_port
        $upstream = $val.upstream
        $model = if ($val.model) { $val.model } else { "auto" }

        # Check port status
        $ready = "DOWN"
        if ($port) {
            try {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/readyz" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
                if ($r -and $r.StatusCode -eq 200) { $ready = "READY" }
            } catch {}
        }

        $rows += [PSCustomObject]@{
            Profile   = $name
            Port      = if ($port) { $port } else { "N/A" }
            Upstream  = $upstream
            Status    = $ready
            Model     = $model
        }
    }

    $rows | Format-Table -AutoSize
    Write-Host "Sub2API Native Upstream: $($reg.sub2api_upstream)" -ForegroundColor Gray
    Write-Host ""
}

function Invoke-Up {
    param([string]$Target)
    $reg = Get-TokenStackRegistry
    $profiles = $reg.profiles.PSObject.Properties

    $headroomExe = Join-Path $env:USERPROFILE ".local\bin\headroom.exe"
    if (-not (Test-Path -LiteralPath $headroomExe)) {
        Write-Error "Headroom binary not found at $headroomExe. Run: uv tool install 'headroom-ai[all]'"
        return
    }

    foreach ($p in $profiles) {
        $name = $p.Name
        if ($Target -and $Target -ne "--all" -and $Target -ne $name) { continue }

        $val = $p.Value
        $port = $val.headroom_port
        if (-not $port) { continue }

        $readyzUrl = "http://127.0.0.1:$port/readyz"
        $isLive = $false
        try {
            $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($r -and $r.StatusCode -eq 200) { $isLive = $true }
        } catch {}

        if ($isLive) {
            Write-Host "[$name] Headroom is already running on port $port (READY)" -ForegroundColor Green
            continue
        }

        Write-Host "[$name] Starting Headroom proxy on port $port -> $($val.upstream)..." -ForegroundColor Yellow
        $dbPath = $val.db_path
        Ensure-ProfileDbDirectory $dbPath

        $argsList = @('proxy', '--port', $port.ToString(), '--anthropic-api-url', $val.upstream)
        if ($dbPath) {
            $argsList += @('--memory-db-path', $dbPath)
        }

        Start-Process -WindowStyle Hidden -FilePath $headroomExe -ArgumentList $argsList

        # Poll for readiness
        $started = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 500
            try {
                $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
                if ($r -and $r.StatusCode -eq 200) { $started = $true; break }
            } catch {}
        }

        if ($started) {
            Write-Host "[$name] Proxy started successfully! (Port $port)" -ForegroundColor Green
        } else {
            Write-Host "[$name] Proxy launch initiated (still loading models in background)." -ForegroundColor Cyan
        }
    }
}

function Invoke-Down {
    param([string]$Target)
    Write-Host "Stopping running Headroom instances..." -ForegroundColor Yellow
    Get-Process -Name headroom -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "All Headroom instances stopped." -ForegroundColor Green
}

function Invoke-Doctor {
    $healthScript = Join-Path $RepoRoot "skills\token-stack-health\scripts\token-stack-health.ps1"
    if (Test-Path -LiteralPath $healthScript) {
        & $healthScript
    } else {
        Invoke-Status
    }
}

function Invoke-Profile {
    param([string[]]$SubArgs)
    if (-not $SubArgs -or $SubArgs.Count -eq 0 -or $SubArgs[0] -eq "list") {
        Invoke-Status
        return
    }

    $subcmd = $SubArgs[0]
    switch ($subcmd) {
        "add" {
            if ($SubArgs.Count -lt 2) {
                Write-Host "Usage: token-stack profile add <name> [--upstream <url>] [--model <model>]" -ForegroundColor Red
                return
            }
            $pName = $SubArgs[1]
            $upstream = "http://127.0.0.1:9284"
            $model = "claude-sonnet-4-5-thinking"

            for ($idx = 2; $idx -lt $SubArgs.Count; $idx++) {
                if ($SubArgs[$idx] -eq "--upstream" -and ($idx + 1) -lt $SubArgs.Count) { $upstream = $SubArgs[$idx+1]; $idx++ }
                if ($SubArgs[$idx] -eq "--model" -and ($idx + 1) -lt $SubArgs.Count) { $model = $SubArgs[$idx+1]; $idx++ }
            }

            $reg = Get-TokenStackRegistry
            $reserved = $reg.profiles.PSObject.Properties | ForEach-Object { $_.Value.headroom_port }
            $newPort = Find-FreeHeadroomPort -StartPort 8787 -ReservedPorts $reserved
            $configDir = Join-Path $env:USERPROFILE ".claude-$pName"
            $dbPath = Join-Path $configDir "headroom-data\headroom.db"

            Set-TokenStackProfile -Name $pName -Config @{
                type = "claude"
                config_dir = $configDir
                headroom_port = $newPort
                upstream = $upstream
                db_path = $dbPath
                model = $model
            }

            Ensure-ProfileDbDirectory $dbPath
            Write-Host "Profile '$pName' registered successfully!" -ForegroundColor Green
            Write-Host "  - Port: $newPort"
            Write-Host "  - Upstream: $upstream"
            Write-Host "  - Config Dir: $configDir"
            Write-Host "  - Model: $model"
        }
        "remove" {
            if ($SubArgs.Count -lt 2) {
                Write-Host "Usage: token-stack profile remove <name>" -ForegroundColor Red
                return
            }
            $pName = $SubArgs[1]
            if (Remove-TokenStackProfile -Name $pName) {
                Write-Host "Profile '$pName' removed." -ForegroundColor Green
            } else {
                Write-Host "Profile '$pName' not found." -ForegroundColor Yellow
            }
        }
        Default {
            Write-Host "Unknown profile command: $subcmd" -ForegroundColor Red
        }
    }
}

function Invoke-Verify {
    param([string]$Target)
    $verifierScript = Join-Path $RepoRoot "core\verifier.ps1"
    if (Test-Path -LiteralPath $verifierScript) {
        & $verifierScript -Profile $Target
    } else {
        Write-Host "Running proxy readiness check..." -ForegroundColor Cyan
        Invoke-Status
    }
}

function Invoke-Test {
    $testRunner = Join-Path $RepoRoot "tests\test-all-layers.cjs"
    if (Test-Path -LiteralPath $testRunner) {
        & node $testRunner
    } else {
        Write-Error "Test runner not found at $testRunner"
    }
}

function Invoke-Bench {
    param([string[]]$SubArgs)
    $tuiPath = Join-Path $RepoRoot "skills\token-stack-benchmark\scripts\benchmark-tui.cjs"
    if (-not (Test-Path -LiteralPath $tuiPath)) {
        Write-Error "Benchmark TUI script not found at $tuiPath"
        return
    }
    & node $tuiPath @SubArgs
}

function Invoke-Data {
    param([string[]]$SubArgs)
    $targetFile = $SubArgs | Select-Object -Last 1
    if (-not $targetFile -or -not (Test-Path -LiteralPath $targetFile)) {
        Write-Host "Usage: token-stack data profile <file.csv|file.tsv>" -ForegroundColor Yellow
        return
    }
    $lensScript = Join-Path $RepoRoot "core\data-lens.cjs"
    $nodeCode = "const { DataLens } = require('$($lensScript.Replace('\', '/'))'); const lens = new DataLens(); console.log(lens.profileData('$($targetFile.Replace('\', '/'))'));"
    & node -e $nodeCode
}

function Invoke-Quant {
    param([string[]]$SubArgs)
    $targetFile = $SubArgs | Select-Object -Last 1
    if (-not $targetFile -or -not (Test-Path -LiteralPath $targetFile)) {
        Write-Host "Usage: token-stack quant tearsheet <file.log>" -ForegroundColor Yellow
        return
    }
    $lensScript = Join-Path $RepoRoot "core\data-lens.cjs"
    $nodeCode = "const fs = require('fs'); const { DataLens } = require('$($lensScript.Replace('\', '/'))'); const lens = new DataLens(); console.log(lens.collapseTearSheet(fs.readFileSync('$($targetFile.Replace('\', '/'))', 'utf-8')));"
    & node -e $nodeCode
}

function Invoke-Cache {
    param([string[]]$SubArgs)
    $action = if ($SubArgs -and $SubArgs.Length -gt 0) { $SubArgs[0].ToLower() } else { "stats" }
    $cacheScript = Join-Path $RepoRoot "core\semantic-cache.cjs"
    if ($action -eq "clear") {
        $nodeCode = "const { SemanticCache } = require('$($cacheScript.Replace('\', '/'))'); const cache = new SemanticCache(); cache.clear(); console.log('Semantic cache cleared successfully.');"
        & node -e $nodeCode
    } else {
        $nodeCode = "const { SemanticCache } = require('$($cacheScript.Replace('\', '/'))'); const cache = new SemanticCache(); console.log(JSON.stringify(cache.stats(), null, 2));"
        & node -e $nodeCode
    }
}

function Invoke-Skill {
    param([string[]]$SubArgs)
    $scope = "auto"
    $topK = 3
    $cleanWords = @()
    if ($SubArgs) {
        for ($i = 0; $i -lt $SubArgs.Length; $i++) {
            $arg = $SubArgs[$i]
            if ($arg -eq "--scope" -and ($i + 1) -lt $SubArgs.Length) {
                $scope = $SubArgs[$i + 1]
                $i++
            } elseif ($arg -eq "--top" -and ($i + 1) -lt $SubArgs.Length) {
                $topK = [int]$SubArgs[$i + 1]
                $i++
            } elseif ($arg.ToLower() -eq "route" -and $i -eq 0) {
                # skip 'route' verb
            } else {
                $cleanWords += $arg
            }
        }
    }
    $query = $cleanWords -join " "
    if (-not $query) {
        Write-Host "Usage: token-stack skill route <prompt> [--scope auto|internal|harness] [--top <k>]" -ForegroundColor Yellow
        return
    }
    $routerScript = Join-Path $RepoRoot "core\skill-router.cjs"
    $escaped = $query.Replace("'", "\'").Replace('"', '\"')
    $nodeCode = "const { SkillRouter } = require('$($routerScript.Replace('\', '/'))'); const router = new SkillRouter(); const res = router.route('$escaped', { scope: '$scope', topK: $topK }); console.log(router.generateActiveSkillContext(res, { scope: '$scope' }));"
    & node -e $nodeCode
}

function Invoke-Setup {
    param([string[]]$SubArgs)
    $setupScript = Join-Path $RepoRoot "skills\token-stack-setup\scripts\token-stack-setup.ps1"
    if (-not (Test-Path -LiteralPath $setupScript)) {
        Write-Host "Setup script not found at $setupScript" -ForegroundColor Red
        return
    }
    $apply = $false
    $profileDir = ""
    if ($SubArgs) {
        foreach ($arg in $SubArgs) {
            if ($arg -eq "-Apply" -or $arg -eq "--apply") { 
                $apply = $true 
            } elseif (-not $arg.StartsWith("-")) { 
                $profileDir = $arg 
            }
        }
    }
    if ($apply -and $profileDir) {
        & $setupScript -ProfileDirectory $profileDir -Apply
    } elseif ($apply) {
        & $setupScript -Apply
    } elseif ($profileDir) {
        & $setupScript -ProfileDirectory $profileDir
    } else {
        & $setupScript
    }
}

# Router
switch ($Command.ToLower()) {
    "status"   { Invoke-Status }
    "setup"    { Invoke-Setup -SubArgs $CommandArgs }
    "up"       { Invoke-Up -Target ($CommandArgs -join " ") }
    "down"     { Invoke-Down -Target ($CommandArgs -join " ") }
    "doctor"   { Invoke-Doctor }
    "profile"  { Invoke-Profile -SubArgs $CommandArgs }
    "verify"   { Invoke-Verify -Target ($CommandArgs -join " ") }
    "test"     { Invoke-Test }
    "bench"    { Invoke-Bench -SubArgs $CommandArgs }
    "data"     { Invoke-Data -SubArgs $CommandArgs }
    "quant"    { Invoke-Quant -SubArgs $CommandArgs }
    "cache"    { Invoke-Cache -SubArgs $CommandArgs }
    "skill"    { Invoke-Skill -SubArgs $CommandArgs }
    "help"     { Show-Help }
    "--help"   { Show-Help }
    "-h"       { Show-Help }
    Default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Help
    }
}
