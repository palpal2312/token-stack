[CmdletBinding()]
param(
    [int]$Cycles = 1000,
    [int]$MaxHeapGrowthMb = 35,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Token-Stack Soak, Stress & Resource Bounds Runner ==="
Write-Host "Cycles: $Cycles | Heap Budget: ${MaxHeapGrowthMb}MB | Timeout: ${TimeoutSeconds}s"

$soakTestPath = Join-Path $repoRoot 'tests\token-stack\soak-stress.test.cjs'
$benchTestPath = Join-Path $repoRoot 'tests\token-stack\benchmarks.test.cjs'

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "`n[1/2] Executing Soak and Memory Bounds Test..." -ForegroundColor Cyan
& node --test $soakTestPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "Soak stress test failed or exceeded resource bounds."
    exit $LASTEXITCODE
}

Write-Host "`n[2/2] Executing Core Microbenchmarks..." -ForegroundColor Cyan
& node --test $benchTestPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "Microbenchmark latency gate failed."
    exit $LASTEXITCODE
}

$sw.Stop()
Write-Host "`nSoak & Benchmark Suite passed cleanly in $($sw.ElapsedMilliseconds)ms." -ForegroundColor Green
exit 0
