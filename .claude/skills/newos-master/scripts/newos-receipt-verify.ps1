param(
  [Parameter(Mandatory = $true)]
  [string[]]$ReceiptPath,
  [string]$ProjectRoot,
  [switch]$AllowNoHashes
)

$ErrorActionPreference = 'Stop'
$projectRoot = if ($ProjectRoot) {
  (Resolve-Path -LiteralPath $ProjectRoot).Path
} else {
  (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
}
$results = [Collections.Generic.List[object]]::new()
$failed = $false

foreach ($requestedReceipt in $ReceiptPath) {
  if (-not (Test-Path -LiteralPath $requestedReceipt)) {
    $results.Add([pscustomobject]@{ receipt = $requestedReceipt; verdict = 'FAIL'; reason = 'receipt missing'; markers = 0; hashes = @() })
    $failed = $true
    continue
  }
  $receipt = (Resolve-Path -LiteralPath $requestedReceipt).Path
  $lines = Get-Content -LiteralPath $receipt -Encoding UTF8
  $markers = @($lines | Where-Object { $_ -match 'JOB_DONE(?:\s*:|\s+)' }).Count
  $hashes = [Collections.Generic.List[object]]::new()

  foreach ($line in $lines) {
    $match = [regex]::Match($line, '^\s*([a-fA-F0-9]{64})\s+(.+?)\s*$')
    if (-not $match.Success) { continue }
    $expected = $match.Groups[1].Value.ToLowerInvariant()
    $relative = $match.Groups[2].Value.Trim().Trim('`').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    $insideRoot = $candidate.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    if (-not $insideRoot -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      $hashes.Add([pscustomobject]@{ path = $relative; expected = $expected; actual = $null; match = $false; reason = 'missing or outside project root' })
      $failed = $true
      continue
    }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    $matches = $actual -eq $expected
    $hashes.Add([pscustomobject]@{ path = $relative; expected = $expected; actual = $actual; match = $matches; reason = if ($matches) { 'ok' } else { 'hash mismatch' } })
    if (-not $matches) { $failed = $true }
  }

  $receiptPass = $markers -gt 0 -and ($AllowNoHashes -or $hashes.Count -gt 0) -and @($hashes | Where-Object { -not $_.match }).Count -eq 0
  if (-not $receiptPass) { $failed = $true }
  $results.Add([pscustomobject]@{
    receipt = $receipt
    verdict = if ($receiptPass) { 'PASS' } else { 'FAIL' }
    reason = if ($markers -eq 0) { 'JOB_DONE marker missing' } elseif (-not $AllowNoHashes -and $hashes.Count -eq 0) { 'no SHA-256 entries' } else { 'verified' }
    markers = $markers
    hashes = $hashes
  })
}

[pscustomobject]@{
  verdict = if ($failed) { 'FAIL' } else { 'PASS' }
  receipts = $results
} | ConvertTo-Json -Depth 10
if ($failed) { exit 2 }
