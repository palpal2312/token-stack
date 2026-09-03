[CmdletBinding()]
param(
    [int]$Runs = 10,
    [switch]$StopOnFailure
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repoRoot 'tests\token-stack\run-tests.cjs'

Write-Host "=== Token-Stack Flake Detection Runner ==="
Write-Host "Target: $runner | Total Iterations: $Runs"

$failedRuns = @()
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 1; $i -le $Runs; $i++) {
    Write-Host "`n--- Iteration $i of $Runs ---" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    & node $runner
    $sw.Stop()
    $code = $LASTEXITCODE

    if ($code -ne 0) {
        Write-Host "FAILED: Iteration $i exited with code $code in $($sw.ElapsedMilliseconds)ms" -ForegroundColor Red
        $failedRuns += [PSCustomObject]@{
            Iteration = $i
            ExitCode = $code
            DurationMs = $sw.ElapsedMilliseconds
        }
        if ($StopOnFailure) {
            Write-Error "Halting on first failure at iteration $i."
            exit $code
        }
    } else {
        Write-Host "PASSED: Iteration $i in $($sw.ElapsedMilliseconds)ms" -ForegroundColor Green
    }
}

$totalSw.Stop()
Write-Host "`n=== Flake Detection Summary ==="
Write-Host "Completed: $Runs runs in $($totalSw.ElapsedMilliseconds)ms"
Write-Host "Passed:    $($Runs - $failedRuns.Count) / $Runs"
Write-Host "Failed:    $($failedRuns.Count) / $Runs"

if ($failedRuns.Count -gt 0) {
    Write-Error "Flake detected: $($failedRuns.Count) iteration(s) failed."
    exit 1
}

Write-Host "FLAKE CERTIFICATION: ZERO FLAKES across $Runs iterations (100% deterministic)." -ForegroundColor Green
exit 0
