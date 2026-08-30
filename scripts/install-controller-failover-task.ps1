param(
  [string]$TaskName = 'NEWSOS-Controller-Failover',
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\plans\reports\orchestrate-260825-sprint02-close\controller-failover.json')
)

$ErrorActionPreference = 'Stop'
$watchdogPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'controller-failover.ps1')).Path
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path

# Orca terminals are interactive desktop resources, so S4U/service execution
# cannot provide a useful controller after logout. This task deliberately runs
# in the logged-on user's session, but it remains enabled on battery power.
$taskArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watchdogPath + '" -Mode Check -ConfigPath "' + $ConfigPath + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Token-free NEWS OS controller lease monitor and standby dispatcher.' -Force | Out-Null
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  LogonType = $task.Principal.LogonType
  AllowStartIfOnBatteries = -not $task.Settings.DisallowStartIfOnBatteries
  DontStopIfGoingOnBatteries = -not $task.Settings.StopIfGoingOnBatteries
  NextRunTime = $info.NextRunTime
}
