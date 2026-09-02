<#
.SYNOPSIS
    Installs Token-Stack Headroom Supervisor as a persistent Windows Scheduled Task.
#>

[CmdletBinding()]
param(
    [string]$TaskName = "TokenStackHeadroomSupervisor",
    [switch]$Uninstall
)

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Scheduled task '$TaskName' removed." -ForegroundColor Green
    exit 0
}

$ScriptPath = "C:\Users\ADMIN\Documents\token-stack\daemons\headroom-supervisor.ps1"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`" -Watch"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Keeps Token-Stack Headroom multi-instance proxies alive across reboots." -Force | Out-Null

Write-Host "Scheduled Task '$TaskName' registered successfully! It will start automatically at user logon." -ForegroundColor Green
