# S18 P3: hash-verify the newest phase12 backup cycle. Prints PASS/FAIL; exit code.
# Runs 'sha256sum -c backup-manifest.sha256' from the cycle (manifest) root so
# relative paths resolve. No backup cycle found == FAIL (nothing to be verified).
param([string]$BackupRoot = (Join-Path $env:LOCALAPPDATA 'NEWSOS'))
$ErrorActionPreference = 'Stop'

$latest = Get-ChildItem $BackupRoot -Filter 'phase12-backups-*' -Directory |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $latest) { Write-Host 'BACKUP-CADENCE-FAIL no backup cycle found'; exit 1 }

Push-Location $latest.FullName
try {
  if (-not (Test-Path 'backup-manifest.sha256')) {
    Write-Host "BACKUP-CADENCE-FAIL manifest missing: $($latest.FullName)\backup-manifest.sha256"
    exit 1
  }
  & sha256sum.exe -c 'backup-manifest.sha256'
  if ($LASTEXITCODE -ne 0) {
    Write-Host "BACKUP-CADENCE-FAIL $($latest.Name) failed sha256 verification"
    exit 1
  }
  Write-Host "BACKUP-CADENCE-PASS $($latest.Name)"
  exit 0
} finally { Pop-Location }