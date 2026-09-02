# Pester 3.4-compatible coverage for the S17 native-runner library.
# Verifies root resolution and child-lifecycle guardrails WITHOUT launching
# daemons or unrelated processes (static/fail-fast checks only).
$here = Split-Path -Parent $PSCommandPath
$root = Split-Path (Split-Path $here -Parent) -Parent
$lib = Join-Path (Split-Path $here -Parent) 'lib\run-s17-runtime.ps1'
. $lib

Describe 'S17 run harness library' {

  It 'resolves the repository root from a nested script directory' {
    $expectedRoot = ((git rev-parse --show-toplevel) | Select-Object -First 1).Trim()
    $resolved = Get-S17RepositoryRoot -ScriptDirectory (Join-Path $root 'scripts')
    $resolved = [IO.Path]::GetFullPath($resolved)
    $expectedRoot = [IO.Path]::GetFullPath($expectedRoot)
    ($resolved -eq $expectedRoot) | Should Be $true
  }

  It 'refuses a malformed repository layout (fails closed)' {
    { Assert-S17RepositoryLayout -RepositoryRoot 'C:\definitely-not-the-repo' } | Should Throw
  }

  It 'refuses a non-loopback daemon URL before any process is started' {
    { Assert-S17PortAvailable -DaemonUri ([uri]'http://evil.example.com:3979') } | Should Throw
  }

  It 'Wait-S17Healthz fails fast on an unreachable endpoint (no hang > 5s)' {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $p = $null
    { Wait-S17Healthz -DaemonUrl 'http://127.0.0.1:59999' -TimeoutSeconds 2 -Process ($p) } | Should Throw
    $sw.Stop()
    $sw.Elapsed.TotalSeconds | Should BeLessThan 6
  }
}
