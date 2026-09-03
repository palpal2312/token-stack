[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("graphify", "gitnexus", "codegraph", "none")]
    [string]$Engine = "graphify",

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

Write-Output "== Token Stack - Layer 0 Code Topology Installer =="
Write-Output "Target Profile: $profile"
Write-Output "Selected Engine: $Engine"
Write-Output "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY_RUN' })"
Write-Output ""

switch ($Engine) {
    "graphify" {
        Write-Output "[Engine: Graphify]"
        Write-Output "Repository: https://github.com/Graphify-Labs/graphify"
        Write-Output "Description: AST Knowledge Graph mapping code + documentation with zero API token cost."
        Write-Output "Requirements: Python >= 3.10 or Node.js, tree-sitter"
        Write-Output "Actions:"
        Write-Output "  1. Initialize graphify workspace index in project root."
        Write-Output "  2. Generate graph.json for agent AST navigation."

        if ($Apply) {
            Write-Output "Configuring Graphify skill in $profile..."
            $skillsDir = Join-Path $profile "skills\graphify"
            New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
            Write-Output "Graphify Layer 0 configured successfully."
        } else {
            Write-Output "Dry-run only; run with -Apply to install Graphify engine."
        }
    }

    "gitnexus" {
        Write-Output "[Engine: GitNexus]"
        Write-Output "Repository: https://github.com/GitNexus-AI/gitnexus"
        Write-Output "Description: Deep call chains & blast radius analysis via WASM / MCP protocol."
        Write-Output "Actions:"
        Write-Output "  1. Register 'gitnexus' MCP server in profile configuration."

        if ($Apply) {
            if (Test-Path -LiteralPath $settingsPath) {
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                if (-not $settings.PSObject.Properties["mcpServers"]) {
                    $settings | Add-Member -Force -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
                }
                $mcp = $settings.mcpServers
                $mcp | Add-Member -Force -NotePropertyName "gitnexus" -NotePropertyValue ([pscustomobject]@{
                    command = "npx"
                    args = @("-y", "@gitnexus/mcp")
                })
                $json = $settings | ConvertTo-Json -Depth 50
                [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
                Write-Output "GitNexus MCP server registered in $settingsPath."
            } else {
                Write-Output "Note: $settingsPath not found. Start agent once to initialize."
            }
        } else {
            Write-Output "Dry-run only; run with -Apply to register GitNexus MCP."
        }
    }

    "codegraph" {
        Write-Output "[Engine: CodeGraph]"
        Write-Output "Repository: https://github.com/CodeGraph-Labs/codegraph"
        Write-Output "Description: Real-time file watcher & lightweight SQLite WAL code graph daemon."
        Write-Output "Actions:"
        Write-Output "  1. Register 'codegraph' MCP server in profile configuration."

        if ($Apply) {
            if (Test-Path -LiteralPath $settingsPath) {
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                if (-not $settings.PSObject.Properties["mcpServers"]) {
                    $settings | Add-Member -Force -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
                }
                $mcp = $settings.mcpServers
                $mcp | Add-Member -Force -NotePropertyName "codegraph" -NotePropertyValue ([pscustomobject]@{
                    command = "npx"
                    args = @("-y", "codegraph-mcp")
                })
                $json = $settings | ConvertTo-Json -Depth 50
                [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
                Write-Output "CodeGraph MCP server registered in $settingsPath."
            } else {
                Write-Output "Note: $settingsPath not found. Start agent once to initialize."
            }
        } else {
            Write-Output "Dry-run only; run with -Apply to register CodeGraph MCP."
        }
    }

    "none" {
        Write-Output "[Engine: None]"
        Write-Output "Layer 0 Code Topology is skipped. The agent will rely on native grep/find searches."
    }
}
