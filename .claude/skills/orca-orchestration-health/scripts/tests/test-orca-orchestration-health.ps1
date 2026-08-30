[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\check-orca-orchestration.ps1'

$json = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Json -ProjectPath $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw "Health script exited $LASTEXITCODE" }
$result = $json | ConvertFrom-Json

if (-not $result.projectPath.EndsWith('scripts\tests')) { throw 'Project path was not preserved' }
if ($null -eq $result.daemon.status) { throw 'Daemon status missing' }
if ($null -eq $result.headroom) { throw 'Headroom result missing' }
if ($null -eq $result.projectSessions) { throw 'Project sessions result missing' }
if ($null -eq $result.runtimeSlots.status) { throw 'Runtime slots result missing' }

# Security contract: output must not expose daemon token contents.
$text = [string]$json
if ($text -match 'daemon-v34\.token|sk-[A-Za-z0-9]') { throw 'Potential secret leaked' }

'PASS: Orca orchestration health schema and redaction checks'
