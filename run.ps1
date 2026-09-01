# Root run wrapper: thin delegation to scripts/run-s17.ps1 (S20 OPEN gap —
# rename/symlink the S17 runner from scripts/ to the root name the plan used).
# Forwards Mode/Shell/StoreDir/DaemonUrl; PowerShell 5.1-safe.
param(
  [ValidateSet('Native', 'Container')][string]$Mode = 'Native',
  [switch]$Shell,
  [string]$StoreDir,
  [string]$DaemonUrl
)
& (Join-Path $PSScriptRoot 'scripts\run-s17.ps1') -Mode $Mode -Shell:$Shell -StoreDir $StoreDir -DaemonUrl $DaemonUrl
exit $LASTEXITCODE