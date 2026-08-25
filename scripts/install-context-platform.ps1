[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("openviking", "obsidian", "local", "none")]
    [string]$Platform = "openviking",

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

Write-Output "== Token Stack - Layer 6 Context Database Platform Installer =="
Write-Output "Target Profile: $profile"
Write-Output "Selected Platform: $Platform"
Write-Output "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY_RUN' })"
Write-Output ""

switch ($Platform) {
    "openviking" {
        Write-Output "[Platform: OpenViking Context Database]"
        Write-Output "Repository: https://github.com/volcengine/OpenViking"
        Write-Output "Description: Self-evolving context database with viking:// virtual filesystem."
        Write-Output "Pillars:"
        Write-Output "  1. viking://knowledge - Hierarchical 3-tier RAG (L0: ~100 tok -> L1: ~2k tok -> L2: On-demand, saves 91% tokens)"
        Write-Output "  2. viking://skills    - Dynamic on-demand skill execution, preventing skill context budget exhaustion"
        Write-Output "  3. viking://memory    - Self-evolving memory ingesting patterns & cases from Layer 5 (MemoraX)"

        if ($Apply) {
            Write-Output "Configuring OpenViking MCP integration in $profile..."
            if (Test-Path -LiteralPath $settingsPath) {
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                if (-not $settings.PSObject.Properties["mcpServers"]) {
                    $settings | Add-Member -Force -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
                }
                $mcp = $settings.mcpServers
                $mcp | Add-Member -Force -NotePropertyName "openviking" -NotePropertyValue ([pscustomobject]@{
                    command = "npx"
                    args = @("-y", "@volcengine/openviking-mcp")
                })
                $json = $settings | ConvertTo-Json -Depth 50
                [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
                Write-Output "OpenViking MCP server registered in $settingsPath."
            } else {
                Write-Output "Note: $settingsPath not found. Start agent once to initialize."
            }
        } else {
            Write-Output "Dry-run only; run with -Apply to configure OpenViking platform."
        }
    }

    "obsidian" {
        Write-Output "[Platform: Obsidian Vault]"
        Write-Output "Description: Human-in-the-loop local Markdown knowledge base with interactive graph visualization."
        $vaultDir = Join-Path $profile "obsidian-vault"
        Write-Output "Vault Path: $vaultDir"

        if ($Apply) {
            New-Item -ItemType Directory -Path (Join-Path $vaultDir "Knowledge") -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $vaultDir "Memories") -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $vaultDir "Skills") -Force | Out-Null
            $indexFile = Join-Path $vaultDir "Home.md"
            if (-not (Test-Path -LiteralPath $indexFile)) {
                $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
                $homeContent = "# Agent Knowledge Base (Obsidian Vault)`n`n[[Knowledge/Architecture]] | [[Knowledge/ProjectSpecs]] | [[Memories/VerifiedCases]]`n"
                [System.IO.File]::WriteAllText($indexFile, $homeContent, $utf8NoBom)
            }
            Write-Output "Obsidian Vault initialized at $vaultDir."
        } else {
            Write-Output "Dry-run only; run with -Apply to initialize Obsidian Vault."
        }
    }

    "local" {
        Write-Output "[Platform: Local Markdown Storage]"
        $memDir = Join-Path $profile "memory"
        Write-Output "Local Storage: $memDir"
        if ($Apply) {
            New-Item -ItemType Directory -Path $memDir -Force | Out-Null
            Write-Output "Local storage ready at $memDir."
        } else {
            Write-Output "Dry-run only; run with -Apply to initialize local storage."
        }
    }

    "none" {
        Write-Output "[Platform: None]"
        Write-Output "Layer 6 Context Database is skipped."
    }
}
