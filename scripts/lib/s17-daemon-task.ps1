function Get-S17DaemonTaskName {
  return 'NEWSOS-S17-SEN-PLANE'
}

function Get-S17DaemonStoreDir {
  return (Join-Path $env:LOCALAPPDATA 'NEWSOS\sen-plane\scheduled-store')
}

function Assert-S17ScheduledDaemonAddress {
  param([Parameter(Mandatory = $true)][string]$Address)
  if ($Address -ne '127.0.0.1:3979') {
    throw "S17 scheduled daemon address must be 127.0.0.1:3979: $Address"
  }
  return $Address
}

function Assert-S17ScheduledDaemonStore {
  param([Parameter(Mandatory = $true)][string]$StoreDir)
  $canonical = [IO.Path]::GetFullPath((Get-S17DaemonStoreDir))
  if ([IO.Path]::GetFullPath($StoreDir) -ne $canonical) {
    throw "S17 scheduled daemon store must be $canonical"
  }
  return $canonical
}

function Assert-S17DaemonTaskAbsent {
  $taskName = Get-S17DaemonTaskName
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "S17 scheduled daemon task already exists: $taskName"
  }
}

function Get-S17DaemonHostArguments {
  param(
    [Parameter(Mandatory = $true)][string]$HostScript,
    [Parameter(Mandatory = $true)][string]$StoreDir,
    [Parameter(Mandatory = $true)][string]$Address
  )
  Assert-S17ScheduledDaemonAddress -Address $Address | Out-Null
  Assert-S17ScheduledDaemonStore -StoreDir $StoreDir | Out-Null
  return ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -StoreDir "{1}" -Address "{2}"' -f $HostScript, $StoreDir, $Address)
}
