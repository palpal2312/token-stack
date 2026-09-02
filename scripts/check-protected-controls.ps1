# Protected-controls runtime guard (S22 Phase-21 CLOSED_GO post-gate policy).
# AFTER the recorded Phase-21 gate (approval P21-A01-20260902, owner GO
# 2026-09-02), the guarded expectation flips: the canonical writer authority
# is LIVE, marked by `phase_21: closed_g0` in product source. The guard now
# fails if:
#   - the CLOSED_GO marker is missing (gate regressed / not transitioned), or
#   - a pre-gate token reappears (`phase_21: blocked`, `legacy_writer: disabled`),
#   - or the legacy rollback flag would be pre-set in env files.
# Used as `npm run protected:check`.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# PSScriptRoot = <repo>\scripts, so a single Split-Path yields the repo root.
# (A double Split-Path would land on <repo>\.. and silently scan nothing —
#   regression that made the pre-gate guard vacuous.)
$srcFiles = @(Get-ChildItem -Path (Join-Path $root 'src'), (Join-Path $root 'go') -Recurse -File -Include *.ts,*.tsx,*.js,*.go -ErrorAction SilentlyContinue)

# 1. The post-gate marker must exist: `phase_21: closed_g0`.
$markers = @($srcFiles | Select-String -Pattern 'phase_21:\s*closed_g0\b' -ErrorAction SilentlyContinue)
if ($markers.Count -eq 0) {
  Write-Error 'PROTECTED-CONTROL VIOLATION: phase_21: closed_g0 marker missing (Phase-21 gate not transitioned or regressed)'
  exit 1
}

# 2. Pre-gate tokens must not reappear.
$preGate = @($srcFiles | Select-String -Pattern 'phase_21:\s*blocked|phase_21:\s*["\x27]?blocked|legacy_writer:\s*disabled' -ErrorAction SilentlyContinue)
if ($preGate.Count -gt 0) {
  $preGate | ForEach-Object { Write-Error "PROTECTED-CONTROL VIOLATION: $($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
  exit 1
}

# 3. Env files must not pre-enable the legacy rollback flag.
$envHits = @(Get-ChildItem -Path $root -Force -File -Include .env,.env.example -ErrorAction SilentlyContinue |
  Select-String -Pattern 'LEGACY_WRITER|SEN_CHAT_LEGACY_WRITER' -ErrorAction SilentlyContinue)
if ($envHits.Count -gt 0) {
  $envHits | ForEach-Object { Write-Error "PROTECTED-CONTROL VIOLATION: $($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
  exit 1
}

Write-Host 'PROTECTED-CONTROLS-OK (phase_21: closed_g0, canonical writer live, legacy rollback not pre-enabled)'
exit 0
