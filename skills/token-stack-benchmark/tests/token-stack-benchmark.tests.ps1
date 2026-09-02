$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\token-stack-benchmark.ps1'

# Test 1: JSON output and correct result count (8 isolated + 7 cumulative = 15 rows)
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Example 01-multi-file-bugfix -Iterations 2 -Json
if ($LASTEXITCODE -ne 0) { throw 'benchmark runner failed' }
$result = $output | ConvertFrom-Json
if ($result.Results.Count -ne 15) { throw "expected 15 benchmark rows, got $($result.Results.Count)" }

# Test 2: Verify cumulative savings progression
$base = $result.Results | Where-Object Key -eq 'base'
$full = $result.Results | Where-Object Key -eq 'L0-6'
if ($full.TotalTokens -ge $base.TotalTokens) { throw 'full stack should consume significantly fewer tokens than baseline' }
if ($full.RawSavings -lt 90) { throw "expected full stack savings > 90%, got $($full.RawSavings)%" }

# Test 3: Verify layer exclusion
$excludedOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Example 01-multi-file-bugfix -ExcludeLayers 0 -Iterations 1 -Json
$exResult = $excludedOutput | ConvertFrom-Json
$l0Row = $exResult.Results | Where-Object Key -eq 'L0'
if ($l0Row.RawSavings -gt 5) { throw 'excluding layer 0 should result in near zero savings for L0 isolated run' }

'PASS token-stack-benchmark test suite'