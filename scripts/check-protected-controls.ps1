# Protected-controls runtime guard (owner-approved phase-21 policy guard).
# Fails closed if ANY enabled-token appears in product source or runtime
# config, or if the legacy writer flag would be enabled. Used as
# `npm run protected:check` to enforce `legacy_writer: disabled` and
# `phase_21: blocked` as a repeatable gate.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$bad = @(
  Get-ChildItem -Path (Join-Path $root 'src'), (Join-Path $root 'go') -Recurse -File -Include *.ts,*.tsx,*.js,*.go -ErrorAction SilentlyContinue |
    Select-String -Pattern 'legacy_writer: enabled|phase_21: enabled|phase_21:\s*=?\s*["\x27]?enabled' -ErrorAction SilentlyContinue
) + @((Get-ChildItem -Path $root -Force -File -Include .env,.env.example -ErrorAction SilentlyContinue | Select-String -Pattern 'LEGACY_WRITER|SEN_CHAT_LEGACY_WRITER' -ErrorAction SilentlyContinue))
$hits = @($bad | Where-Object { $_ -and $_.Line -match '(?<!disabled: )enabled|LEGACY_WRITER|SEN_CHAT_LEGACY_WRITER' })
if ($hits.Count -gt 0) {
  $hits | ForEach-Object { Write-Error "PROTECTED-CONTROL VIOLATION: $($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
  exit 1
}
Write-Host 'PROTECTED-CONTROLS-OK (legacy_writer disabled, phase_21 blocked)'
exit 0