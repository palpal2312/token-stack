[CmdletBinding()]
param([switch]$Coverage)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repoRoot 'tests\token-stack\run-tests.cjs'
$nodeArgs = @()
if ($Coverage) { $nodeArgs += '--experimental-test-coverage' }
$nodeArgs += $runner

$output = & node @nodeArgs 2>&1
$output | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Coverage) {
    $summary = ($output -join "`n")
    $match = [regex]::Match($summary, 'all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)')
    if (-not $match.Success) { throw 'Could not read the Node coverage summary.' }
    $lineCoverage = [double]$match.Groups[1].Value
    $branchCoverage = [double]$match.Groups[2].Value
    if ($lineCoverage -lt 80 -or $branchCoverage -lt 65) {
        throw "Coverage below Token-Stack floor: lines=$lineCoverage% (min 80%), branches=$branchCoverage% (min 65%)."
    }
    Write-Host "Coverage gate passed: lines=$lineCoverage%, branches=$branchCoverage%."
}
