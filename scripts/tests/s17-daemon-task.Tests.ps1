$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts\lib\s17-daemon-task.ps1')

Describe 'S17 scheduled daemon task contract' {
  It 'uses the exact separate daemon task name' {
    Get-S17DaemonTaskName | Should Be 'NEWSOS-S17-SEN-PLANE'
    Get-S17DaemonTaskName | Should Not Be 'NEWSOS-S18-SLO-Probe'
  }

  It 'uses a current-user scheduled-store path' {
    Get-S17DaemonStoreDir | Should Be (Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\scheduled-store')
  }

  It 'accepts only the canonical daemon address' {
    Assert-S17ScheduledDaemonAddress -Address '127.0.0.1:3979' | Should Be '127.0.0.1:3979'
    { Assert-S17ScheduledDaemonAddress -Address '0.0.0.0:3979' } | Should Throw
    { Assert-S17ScheduledDaemonAddress -Address 'localhost:3979' } | Should Throw
    { Assert-S17ScheduledDaemonAddress -Address '127.0.0.1:4000' } | Should Throw
  }

  It 'accepts only the canonical current-user scheduled store' {
    $store = Get-S17DaemonStoreDir
    Assert-S17ScheduledDaemonStore -StoreDir $store | Should Be ([IO.Path]::GetFullPath($store))
    { Assert-S17ScheduledDaemonStore -StoreDir (Join-Path $TestDrive 'other-store') } | Should Throw
  }

  It 'builds a PowerShell task action containing the host, store, and loopback address' {
    $store = Get-S17DaemonStoreDir
    $args = Get-S17DaemonHostArguments -HostScript 'C:\work\s17-daemon-host.ps1' -StoreDir $store -Address '127.0.0.1:3979'
    $args | Should Match 's17-daemon-host\.ps1'
    $args | Should Match 'scheduled-store'
    $args | Should Match '127\.0\.0\.1:3979'
  }

  It 'refuses to replace an existing scheduled daemon task' {
    Mock Get-ScheduledTask { [pscustomobject]@{ TaskName = 'NEWSOS-S17-SEN-PLANE' } }
    { Assert-S17DaemonTaskAbsent } | Should Throw
  }

  It 'keeps the existing S18 probe task outside task lifecycle scripts' {
    $install = Get-Content -Raw (Join-Path $repo 'scripts\install-s17-daemon-task.ps1')
    $remove = Get-Content -Raw (Join-Path $repo 'scripts\remove-s17-daemon-task.ps1')
    ($install + $remove) | Should Not Match 'NEWSOS-S18-SLO-Probe'
  }

  It 'starts the exact daemon task after registration' {
    $install = Get-Content -Raw (Join-Path $repo 'scripts\install-s17-daemon-task.ps1')
    $install | Should Match 'Start-ScheduledTask -TaskName \$taskName'
  }
}
