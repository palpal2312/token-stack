<#
.SYNOPSIS
    Declarative Hook Injector for Agent Profile settings.json / hooks.json.
.DESCRIPTION
    Injects a SessionStart hook that invokes headroom-ensure.ps1 on startup,
    ensuring Headroom is only launched/checked on agent restart without
    corrupting existing hooks or configs.
#>

function Inject-SessionStartHook {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigDir,

        [string]$HookScriptPath,

        [string]$AgentType = "claude"
    )

    $currentDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    $resolvedRepo = (Split-Path -Parent $currentDir)
    if (-not $HookScriptPath) {
        $HookScriptPath = Join-Path $resolvedRepo "scripts\headroom-ensure.ps1"
        if (-not (Test-Path -LiteralPath $HookScriptPath)) {
            $HookScriptPath = Join-Path $currentDir "scripts\headroom-ensure.ps1"
        }
    }

    if (-not (Test-Path -LiteralPath $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }

    $targetFile = if ($AgentType -eq "codex") {
        Join-Path $ConfigDir "hooks.json"
    } else {
        Join-Path $ConfigDir "settings.json"
    }

    $rawText = "{}"
    if (Test-Path -LiteralPath $targetFile) {
        $rawText = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
    }

    $configObj = $null
    try {
        $configObj = ($rawText | ConvertFrom-Json)
    } catch {}
    if ($null -eq $configObj) {
        $configObj = [PSCustomObject]@{}
    }

    # Ensure hooks object
    if (-not $configObj.PSObject.Properties['hooks'] -or $null -eq $configObj.hooks) {
        $configObj | Add-Member -Force -NotePropertyName 'hooks' -NotePropertyValue ([PSCustomObject]@{})
    }

    if (-not $configObj.hooks.PSObject.Properties['SessionStart'] -or $null -eq $configObj.hooks.SessionStart) {
        $configObj.hooks | Add-Member -Force -NotePropertyName 'SessionStart' -NotePropertyValue @()
    }

    # Normalize command path
    $escapedScript = $HookScriptPath.Replace('\', '/')
    $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$escapedScript`""

    # Check if already present
    $exists = $false
    foreach ($entry in $configObj.hooks.SessionStart) {
        if ($entry.hooks) {
            foreach ($h in $entry.hooks) {
                if ($h.command -and $h.command -match 'headroom-ensure') {
                    $exists = $true
                    break
                }
            }
        }
    }

    if (-not $exists) {
        $newHookEntry = [PSCustomObject]@{
            matcher = "startup|resume|clear|compact"
            hooks   = @(
                [PSCustomObject]@{
                    type    = "command"
                    command = $cmd
                    timeout = 120
                }
            )
        }

        $sessionStartList = @($configObj.hooks.SessionStart)
        $sessionStartList += $newHookEntry
        $configObj.hooks.SessionStart = $sessionStartList

        $json = $configObj | ConvertTo-Json -Depth 15
        [System.IO.File]::WriteAllText($targetFile, $json, [System.Text.UTF8Encoding]::new($false))
    }

    return [PSCustomObject]@{
        TargetFile     = $targetFile
        Injected       = (-not $exists)
        AlreadyPresent = $exists
    }
}

if ($ExecutionContext.SessionState.Module) {
    Export-ModuleMember -Function Inject-SessionStartHook
}
