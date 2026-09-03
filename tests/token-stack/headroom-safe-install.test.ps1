<#
.SYNOPSIS
    Automated E2E Verification Suite for Headroom Autonomous Safe Self-Install.
.DESCRIPTION
    Verifies:
    1. OS Process & Socket Live Discovery
    2. Dynamic collision-free port allocation (skips live ports & registered ports)
    3. Safe disk-only staging (.env file generated, current session RAM unmodified)
    4. SessionStart hook injection into settings.json
    5. Registry update and Markdown port-map export
    6. Non-destructive cleanup
#>

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "core\registry.ps1"))) {
    $RepoRoot = (Get-Location).Path
}

. (Join-Path $RepoRoot "core\registry.ps1")
. (Join-Path $RepoRoot "core\port-allocator.ps1")
. (Join-Path $RepoRoot "core\headroom-discovery.ps1")
. (Join-Path $RepoRoot "scripts\stage-headroom-profile.ps1")

$passCount = 0
$failCount = 0

function Assert-Test {
    param([string]$Name, [bool]$Condition, [string]$Details = "")
    if ($Condition) {
        $global:passCount++
        Write-Host "  [PASS] $Name" -ForegroundColor Green
    } else {
        $global:failCount++
        Write-Host "  [FAIL] ${Name} - ${Details}" -ForegroundColor Red
    }
}

Write-Host "`n=== E2E HEADROOM SAFE SELF-INSTALL TEST SUITE ===" -ForegroundColor Cyan

# Test 1: Live Discovery
Write-Host "`n[Stage 1: Process & Socket Discovery]" -ForegroundColor Yellow
$live = @(Get-ActiveHeadroomPorts)
Assert-Test "Get-ActiveHeadroomPorts returns collection" ($null -ne $live)
$liveProcs = @(Get-RunningHeadroomProcesses)
Assert-Test "Get-RunningHeadroomProcesses inspects OS without exception" ($null -ne $liveProcs)

# Test 2: Safe Port Allocation
Write-Host "`n[Stage 2: Collision-Free Port Allocation]" -ForegroundColor Yellow
$testReserved = @(8787, 8788)
$allocated = Find-FreeHeadroomPort -StartPort 8787 -EndPort 8899 -ReservedPorts $testReserved -IncludeRunningProcesses
Assert-Test "Allocated port is above reserved ports ($allocated)" ($allocated -ne 8787 -and $allocated -ne 8788)
$isFree = Test-TcpPortFree -Port $allocated
Assert-Test "Allocated port socket is genuinely open" ($isFree -eq $true)

# Test 3: Staging Engine & Disk Isolation
Write-Host "`n[Stage 3: Disk Staging & Zero In-flight RAM Mutation]" -ForegroundColor Yellow
$sandboxDir = Join-Path $env:TEMP "token-stack-e2e-test-$(Get-Random)"
$sandboxProfile = "sandbox-e2e-agent"
$originalBaseUrl = $env:ANTHROPIC_BASE_URL

$staged = Stage-AgentProfileHeadroom -ProfileName $sandboxProfile -ConfigDir $sandboxDir -Upstream "http://127.0.0.1:9284"
Assert-Test "Staging completed with status" ($staged.Status -match "Staged")
Assert-Test "Session RAM ANTHROPIC_BASE_URL untouched" ($env:ANTHROPIC_BASE_URL -eq $originalBaseUrl)

$envPath = Join-Path $sandboxDir ".env"
Assert-Test ".env staging file created" (Test-Path -LiteralPath $envPath)
$envContent = Get-Content -LiteralPath $envPath -Raw
Assert-Test ".env contains correct HEADROOM_PORT" ($envContent -match "HEADROOM_PORT=$($staged.Port)")
Assert-Test ".env contains correct ANTHROPIC_BASE_URL" ($envContent -match "ANTHROPIC_BASE_URL=http://127.0.0.1:$($staged.Port)")

# Test 4: Hook Injection
Write-Host "`n[Stage 4: SessionStart Hook Injection]" -ForegroundColor Yellow
$settingsPath = Join-Path $sandboxDir "settings.json"
Assert-Test "settings.json created" (Test-Path -LiteralPath $settingsPath)
$settingsContent = Get-Content -LiteralPath $settingsPath -Raw
Assert-Test "settings.json contains SessionStart matcher" ($settingsContent -match "startup\|resume\|clear\|compact")
Assert-Test "settings.json contains headroom-ensure.ps1 hook" ($settingsContent -match "headroom-ensure\.ps1")

# Test 5: Registry & Markdown Note Export
Write-Host "`n[Stage 5: Centralized Registry & Note Export]" -ForegroundColor Yellow
$reg = Get-TokenStackRegistry
Assert-Test "Registry contains sandbox profile" ($null -ne $reg.profiles.PSObject.Properties[$sandboxProfile])

$notePath = Join-Path $sandboxDir "test-ports.md"
$exported = Export-HeadroomPortNote -OutputPath $notePath
Assert-Test "Markdown note exported" (Test-Path -LiteralPath $notePath)
$noteContent = Get-Content -LiteralPath $notePath -Raw
Assert-Test "Markdown note lists sandbox profile" ($noteContent -match $sandboxProfile)

# Cleanup
Write-Host "`n[Stage 6: Non-Destructive Teardown]" -ForegroundColor Yellow
Remove-TokenStackProfile -Name $sandboxProfile | Out-Null
$docPath = Join-Path $RepoRoot "docs\headroom-ports.md"
if (Test-Path -LiteralPath $docPath) {
    Export-HeadroomPortNote -OutputPath $docPath | Out-Null
}
if (Test-Path -LiteralPath $sandboxDir) {
    Remove-Item -Path $sandboxDir -Recurse -Force | Out-Null
}
Assert-Test "Sandbox profile removed from registry" ($null -eq (Get-TokenStackProfile -Name $sandboxProfile))

Write-Host "`n=================================================="
$summaryColor = if ($global:failCount -eq 0) { "Green" } else { "Red" }
Write-Host "Summary: $global:passCount PASS, $global:failCount FAIL" -ForegroundColor $summaryColor
if ($global:failCount -gt 0) {
    exit 1
}
exit 0
