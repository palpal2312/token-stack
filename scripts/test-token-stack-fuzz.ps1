[CmdletBinding()]
param(
    [int]$Iterations = 1000,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Token-Stack Bounded Fuzz Runner ==="
Write-Host "Iterations: $Iterations | Timeout: ${TimeoutSeconds}s"

$nodeScript = @"
const path = require('path');
const repoRoot = '$($repoRoot.Replace('\', '/'))';
const { DataLens } = require(path.join(repoRoot, 'core', 'data-lens.cjs'));
const { foldMessages } = require(path.join(repoRoot, 'core', 'turn-folder.cjs'));
const { SemanticCache } = require(path.join(repoRoot, 'core', 'semantic-cache.cjs'));
const crypto = require('crypto');

const lens = new DataLens({ maxSampleSize: 100 });
const cache = new SemanticCache({ dbPath: null, autoLoad: false });

console.log('Fuzzing pure parsers with $Iterations random inputs...');

for (let i = 0; i < $Iterations; i++) {
  // 1. Random bytes string for DataLens
  const randomBytes = crypto.randomBytes(Math.floor(Math.random() * 500) + 1);
  const text = randomBytes.toString('utf8');
  try {
    lens.profileData(text);
  } catch (e) {
    console.error('DataLens crash at iteration', i, e);
    process.exit(1);
  }

  // 2. Random vectorize for SemanticCache
  try {
    cache.vectorize(text);
  } catch (e) {
    console.error('SemanticCache vectorize crash at iteration', i, e);
    process.exit(1);
  }

  // 3. Random messages for foldMessages
  try {
    foldMessages([{ role: 'user', content: text }], { liveWindow: 1 });
  } catch (e) {
    console.error('foldMessages crash at iteration', i, e);
    process.exit(1);
  }
}

console.log('Pure parser fuzzing completed successfully: 0 crashes across all iterations.');
process.exit(0);
"@

$runnerPath = Join-Path $repoRoot 'tests\token-stack\helpers\scratch-fuzzer.cjs'
Set-Content -Path $runnerPath -Value $nodeScript -Encoding UTF8

try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & node $runnerPath
    $sw.Stop()
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fuzzing detected a crash or non-zero exit."
        exit $LASTEXITCODE
    }
    Write-Host "Fuzz run passed in $($sw.ElapsedMilliseconds)ms."
} finally {
    if (Test-Path $runnerPath) {
        Remove-Item -Path $runnerPath -Force -ErrorAction SilentlyContinue
    }
}

exit 0
