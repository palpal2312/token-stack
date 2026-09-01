# S18 P3: installs the observable probe scheduled task + runs the backup-cadence
# verification. Register the SLO probe loop to run every 30 minutes (each run
# keeps the watch alive; the loop is long-running so the schedule is a safety
# detector, matching the controller-failover watchdog pattern).

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$probe = Join-Path $PSScriptRoot 's18-slo-probes.ps1'

$existing = Get-ScheduledTask -TaskName 'NEWSOS-S18-SLO-Probe' -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host 'S18 probe task already registered (state=' $existing.State '). Recreating.'
  Unregister-ScheduledTask -TaskName 'NEWSOS-S18-SLO-Probe' -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $probe + '"')
Register-ScheduledTask -TaskName 'NEWSOS-S18-SLO-Probe' -Action $action -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)) -Force | Out-Null
Write-Host 'S18 probe task registered (every 30 min safety detector).'

# Backup-cadence verification (S18 P3): hash-verify the newest backup cycle.
$latest = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'NEWSOS') -Filter 'phase12-backups-*' -Directory | Sort-Object Name -Descending | Select-Object -First 1
if ($latest) {
  Push-Location $latest.FullName
  try {
    $bad = (sha256sum.exe -c backup-manifest.sha256 2>$null | Select-String -Pattern ': FAILED' | Measure-Object).Count
    if ($bad -gt 0) { throw "backup cadence check FAILED ($bad files) in $($latest.Name)" }
    Write-Host "backup cadence OK: $($latest.Name)"
  } finally { Pop-Location }
} else {
  Write-Host 'no backup cycle found; cadence check skipped (expected on first run)'
}
Write-Host 'S18-P3-INSTALL-OK'