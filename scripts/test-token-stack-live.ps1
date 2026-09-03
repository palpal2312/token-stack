[CmdletBinding()]
param([string]$Profile = $null)

$ErrorActionPreference = 'Stop'
if ($env:TOKEN_STACK_ALLOW_LIVE_VERIFICATION -ne '1') {
    throw 'Set TOKEN_STACK_ALLOW_LIVE_VERIFICATION=1 before running a live verifier test.'
}

& (Join-Path $PSScriptRoot '..\core\verifier.ps1') -Profile $Profile -AllowLive
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
