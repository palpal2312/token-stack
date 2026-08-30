param(
  [Parameter(Mandatory = $true)]
  [string[]]$Command,
  [switch]$ProbeVersion,
  [ValidateRange(1, 60)]
  [int]$TimeoutSeconds = 10
)

$ErrorActionPreference = 'Stop'
$results = [Collections.Generic.List[object]]::new()
$failed = $false

foreach ($name in $Command) {
  $resolved = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $resolved) {
    $results.Add([pscustomobject]@{ command = $name; resolved = $null; versionProbe = 'not-run'; verdict = 'FAIL'; detail = 'command not found' })
    $failed = $true
    continue
  }

  $probeState = 'not-requested'
  $detail = 'executable resolved; provider auth/quota not proven'
  $verdict = 'PASS'
  if ($ProbeVersion) {
    $process = [Diagnostics.Process]::new()
    $source = [string]$resolved.Source
    $extension = [IO.Path]::GetExtension($source).ToLowerInvariant()
    if ($extension -eq '.ps1') {
      $process.StartInfo = [Diagnostics.ProcessStartInfo]@{
        FileName = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
        Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$source`" --version"
        UseShellExecute = $false
        RedirectStandardOutput = $true
        RedirectStandardError = $true
        CreateNoWindow = $true
      }
    } elseif ($extension -in @('.cmd', '.bat')) {
      $process.StartInfo = [Diagnostics.ProcessStartInfo]@{
        FileName = (Join-Path $env:SystemRoot 'System32\cmd.exe')
        Arguments = "/d /c `"`"$source`" --version`""
        UseShellExecute = $false
        RedirectStandardOutput = $true
        RedirectStandardError = $true
        CreateNoWindow = $true
      }
    } else {
      $process.StartInfo = [Diagnostics.ProcessStartInfo]@{
        FileName = $source
        Arguments = '--version'
        UseShellExecute = $false
        RedirectStandardOutput = $true
        RedirectStandardError = $true
        CreateNoWindow = $true
      }
    }
    try {
      $null = $process.Start()
      if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        $probeState = 'timeout'
        $verdict = 'FAIL'
        $detail = "--version exceeded ${TimeoutSeconds}s"
        $failed = $true
      } elseif ($process.ExitCode -ne 0) {
        $probeState = 'failed'
        $verdict = 'FAIL'
        $detail = "--version exit=$($process.ExitCode)"
        $failed = $true
      } else {
        $probeState = 'pass'
        $detail = (($process.StandardOutput.ReadToEnd() -split "`r?`n")[0]).Trim()
      }
    } catch {
      $probeState = 'failed'
      $verdict = 'FAIL'
      $detail = $_.Exception.Message
      $failed = $true
    } finally {
      $process.Dispose()
    }
  }

  $results.Add([pscustomobject]@{
    command = $name
    resolved = $resolved.Source
    versionProbe = $probeState
    verdict = $verdict
    detail = $detail
  })
}

[pscustomobject]@{
  verdict = if ($failed) { 'FAIL' } else { 'PASS' }
  note = 'Executable/version checks do not prove provider authentication, quota, subscription window or billable canary success.'
  commands = $results
} | ConvertTo-Json -Depth 8
if ($failed) { exit 2 }
