$ErrorActionPreference = 'Continue'
$integrationRoot = 'C:\Users\ADMIN\orca\workspaces\source\sprint-05-lane-3-privacy-continuity'
$promptPath = Join-Path $PSScriptRoot 'integration-prompt.txt'
$stdoutPath = Join-Path $PSScriptRoot 'integration-stdout.log'
$stderrPath = Join-Path $PSScriptRoot 'integration-stderr.log'
$codexPath = 'C:\Users\ADMIN\AppData\Roaming\npm\codex.cmd'
$arguments = @(
  'exec',
  '--ignore-user-config',
  '--dangerously-bypass-approvals-and-sandbox',
  '-C',
  ('"' + $integrationRoot + '"'),
  '-'
)
$process = Start-Process -FilePath $codexPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru `
  -RedirectStandardInput $promptPath -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
exit $process.ExitCode
