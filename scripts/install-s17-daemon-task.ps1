param(
  [string]$StoreDir = (Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\scheduled-store'),
  [string]$Address = '127.0.0.1:3979'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\s17-daemon-task.ps1')
. (Join-Path $PSScriptRoot 'lib\run-s17-runtime.ps1')

$taskName = Get-S17DaemonTaskName
Assert-S17DaemonTaskAbsent
Assert-S17ScheduledDaemonAddress -Address $Address | Out-Null
Assert-S17ScheduledDaemonStore -StoreDir $StoreDir | Out-Null
Assert-S17PortAvailable -DaemonUri ([uri]("http://$Address"))
New-Item -ItemType Directory -Force -Path $StoreDir | Out-Null
$hostScript = Join-Path $PSScriptRoot 's17-daemon-host.ps1'
$taskArgs = Get-S17DaemonHostArguments -HostScript $hostScript -StoreDir $StoreDir -Address $Address
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Local loopback-only NEWS OS sen-plane runtime; no release or cutover.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "S17 daemon task registered: $taskName store=$StoreDir address=$Address"
