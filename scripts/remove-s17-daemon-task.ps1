param(
  [switch]$RemoveStore
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\s17-daemon-task.ps1')

$taskName = Get-S17DaemonTaskName
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { throw "S17 scheduled daemon task is not registered: $taskName" }
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
if ($RemoveStore) {
  $store = [IO.Path]::GetFullPath((Get-S17DaemonStoreDir))
  $allowed = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\scheduled-store'))
  if ($store -ne $allowed) { throw 'refusing to remove a store outside the scheduled S17 local store' }
  if (Test-Path $store) { Remove-Item -LiteralPath $store -Recurse -Force }
}
Write-Host "S17 daemon task removed: $taskName"
