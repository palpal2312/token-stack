[CmdletBinding()]
param(
    [switch]$All,
    [switch]$Json,
    [string]$ProfileDirectory
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tuiScript = Join-Path $scriptDir "benchmark-tui.cjs"

$nodeArgs = @()
if ($All) { $nodeArgs += "--all" }
if ($Json) { $nodeArgs += "--json" }

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node "$tuiScript" @nodeArgs
} else {
    Write-Error "Node.js is required to run the Token Stack Benchmark TUI."
}
