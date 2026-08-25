[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("memorax", "mem0", "local", "none")]
    [string]$Provider = "none",

    [string]$ProfileDirectory = "$HOME\.claude",
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ProfileDir {
    param([string]$Path)
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    if ($expanded -match "^~") { $expanded = $expanded -replace "^~", $HOME }
    return [System.IO.Path]::GetFullPath($expanded)
}

$profile = Resolve-ProfileDir $ProfileDirectory
$settingsPath = Join-Path $profile "settings.json"

Write-Output "== Token Stack - Layer 5 Memory Installer =="
Write-Output "Target Profile: $profile"
Write-Output "Selected Provider: $Provider"
Write-Output "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY_RUN' })"
Write-Output ""

switch ($Provider) {
    "memorax" {
        Write-Output "[Provider: MemoraX Code]"
        Write-Output "Repository: https://github.com/memorax-ai/memorax-code"
        Write-Output "Description: Cross-session procedure memory & context preservation for AI coding agents."
        Write-Output "Requirements: Node.js >= 20, npm"
        Write-Output "Actions:"
        Write-Output "  1. npm install -g @memorax/memorax-code"
        Write-Output "  2. memorax-code setup"

        if ($Apply) {
            if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
                throw "npm is required to install @memorax/memorax-code. Please install Node.js >= 20 first."
            }
            Write-Output "Installing @memorax/memorax-code globally..."
            npm install -g @memorax/memorax-code
            Write-Output "Running memorax-code setup..."
            memorax-code setup
            Write-Output "MemoraX Code setup completed successfully."
        } else {
            Write-Output "Dry-run only; run with -Apply to execute installation."
        }
    }

    "mem0" {
        Write-Output "[Provider: Mem0 MCP]"
        Write-Output "Repository: https://github.com/mem0ai/mem0"
        Write-Output "Description: Universal vector & graph long-term memory via MCP protocol."
        Write-Output "Actions:"
        Write-Output "  1. Register 'mem0' MCP server in profile configuration."

        if ($Apply) {
            if (Test-Path -LiteralPath $settingsPath) {
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                if (-not $settings.PSObject.Properties["mcpServers"]) {
                    $settings | Add-Member -Force -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
                }
                $mcp = $settings.mcpServers
                $mcp | Add-Member -Force -NotePropertyName "mem0" -NotePropertyValue ([pscustomobject]@{
                    command = "npx"
                    args = @("-y", "@mem0/mcp")
                })
                $json = $settings | ConvertTo-Json -Depth 50
                [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
                Write-Output "Mem0 MCP server registered in $settingsPath."
            } else {
                Write-Output "Note: $settingsPath not found. Please start the agent once to initialize settings."
            }
        } else {
            Write-Output "Dry-run only; run with -Apply to register Mem0 MCP."
        }
    }

    "local" {
        Write-Output "[Provider: Local Knowledge Memory]"
        Write-Output "Description: 100% offline, zero-cloud knowledge memory stored in profile directory."
        $memDir = Join-Path $profile "memory"
        Write-Output "Memory Storage: $memDir"

        if ($Apply) {
            New-Item -ItemType Directory -Path $memDir -Force | Out-Null
            $readmeMem = Join-Path $memDir "MEMORY_INDEX.md"
            if (-not (Test-Path -LiteralPath $readmeMem)) {
                $initText = "# Local Agent Memory Index`n`nThis directory stores long-term persistent notes, verified architectural patterns, and project conventions across sessions.`n`n- architecture.md: System components and core constraints.`n- gotchas.md: Known bugs and verified workarounds.`n- workflows.md: Verified commands and build sequences.`n"
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                [System.IO.File]::WriteAllText($readmeMem, $initText, $utf8NoBom)
            }
            Write-Output "Local memory directory initialized at $memDir."
        } else {
            Write-Output "Dry-run only; run with -Apply to initialize local memory directory."
        }
    }

    "none" {
        Write-Output "[Provider: None]"
        Write-Output "Layer 5 Memory is skipped. The 4 core token reduction layers remain active."
    }
}
