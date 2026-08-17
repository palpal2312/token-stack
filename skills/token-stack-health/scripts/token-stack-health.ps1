[CmdletBinding()]
param(
    [string]$ProfileDirectory,
    [switch]$Json,
    [switch]$SkipRuntimeProbes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Status {
    param([bool]$Good, [bool]$Partial = $false)
    if ($Good) { return 'OK' }
    if ($Partial) { return 'WARN' }
    return 'NO'
}

function Get-ProfileDirectory {
    param([string]$Requested)
    if ($Requested) { return [Environment]::ExpandEnvironmentVariables($Requested) }
    if ($env:CLAUDE_CONFIG_DIR) { return [Environment]::ExpandEnvironmentVariables($env:CLAUDE_CONFIG_DIR) }
    return (Join-Path $HOME '.claude')
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

function Get-PropertyValue {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-PluginInstalled {
    param($Manifest, [string]$PluginName)
    $plugins = Get-PropertyValue $Manifest 'plugins'
    $entry = Get-PropertyValue $plugins $PluginName
    if ($null -eq $entry) { return $false }
    $items = if ($entry -is [Array]) { @($entry) } else { @($entry) }
    foreach ($item in $items) {
        $installPath = Get-PropertyValue $item 'installPath'
        if ($installPath -and (Test-Path -LiteralPath $installPath)) { return $true }
    }
    return $false
}

function Test-PluginEnabled {
    param($Settings, [string]$PluginName)
    $enabled = Get-PropertyValue $Settings 'enabledPlugins'
    return ((Get-PropertyValue $enabled $PluginName) -eq $true)
}

function Get-SafeModel {
    $candidates = @($env:CLAUDE_MODEL, $env:ANTHROPIC_MODEL, $env:CLAUDE_CODE_SUBAGENT_MODEL)
    foreach ($candidate in $candidates) {
        if ($candidate -and $candidate -match '^[A-Za-z0-9._:/-]{1,128}$') { return $candidate }
    }
    return 'unknown'
}

function Get-CommandInfo {
    param([string]$Name)
    try {
        $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
        return [pscustomobject]@{ Present = $true; Source = $command.Source; Version = 'present' }
    } catch {
        return [pscustomobject]@{ Present = $false; Source = ''; Version = 'unknown' }
    }
}

function Get-HeadroomProbe {
    param([string]$BaseUrl, [switch]$Skip)
    $result = [ordered]@{ Configured = $false; Running = $false; StatusCode = $null; Endpoint = '' }
    if (-not $BaseUrl) { return [pscustomobject]$result }
    try {
        $uri = [Uri]$BaseUrl
        $result.Configured = ($uri.IsLoopback -and $uri.Scheme -eq 'http' -and $uri.Port -gt 0)
        if (-not $result.Configured -or $Skip) { return [pscustomobject]$result }
        foreach ($path in @('/readyz', '/health')) {
            try {
                $response = Invoke-WebRequest -Uri ([Uri]::new($uri, $path)) -UseBasicParsing -TimeoutSec 3
                $result.StatusCode = [int]$response.StatusCode
                $result.Endpoint = $path
                if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                    $result.Running = $true
                    break
                }
            } catch {
                if ($_.Exception.Response) {
                    try { $result.StatusCode = [int]$_.Exception.Response.StatusCode.value__ } catch { }
                }
            }
        }
    } catch { }
    return [pscustomobject]$result
}

$profile = Get-ProfileDirectory $ProfileDirectory
$settingsPath = Join-Path $profile 'settings.json'
$manifestPath = Join-Path $profile 'plugins\installed_plugins.json'
$settings = Read-JsonFile $settingsPath
$manifest = Read-JsonFile $manifestPath
$components = @()

$claude = Get-CommandInfo 'claude'
$components += [pscustomobject]@{ Name = 'harness'; Status = (Get-Status $claude.Present); Detail = if ($claude.Present) { "claude $($claude.Version)" } else { 'claude not found' } }
$components += [pscustomobject]@{ Name = 'model'; Status = if ((Get-SafeModel) -eq 'unknown') { 'UNKNOWN' } else { 'OK' }; Detail = "configured=$((Get-SafeModel)) runtime=external" }

foreach ($plugin in @('ponytail@ponytail', 'caveman@caveman')) {
    $installed = Test-PluginInstalled $manifest $plugin
    $enabled = Test-PluginEnabled $settings $plugin
    $good = $installed -and $enabled
    $partial = $installed -or $enabled
    $components += [pscustomobject]@{
        Name = $plugin.Split('@')[0]
        Status = Get-Status $good $partial
        Detail = "installed=$($installed.ToString().ToLowerInvariant()) enabled=$($enabled.ToString().ToLowerInvariant())"
    }
}

$rtk = Get-CommandInfo 'rtk'
$rtkBinary = Join-Path $env:LOCALAPPDATA 'rtk\rtk.exe'
$rtkBinaryPresent = Test-Path -LiteralPath $rtkBinary -PathType Leaf
$components += [pscustomobject]@{
    Name = 'rtk'
    Status = Get-Status ($rtk.Present -and $rtkBinaryPresent) ($rtk.Present -or $rtkBinaryPresent)
    Detail = "shim=$($rtk.Present.ToString().ToLowerInvariant()) binary=$($rtkBinaryPresent.ToString().ToLowerInvariant()) version=$($rtk.Version)"
}

$baseUrl = Get-PropertyValue (Get-PropertyValue $settings 'env') 'ANTHROPIC_BASE_URL'
$headroom = Get-HeadroomProbe $baseUrl -Skip:$SkipRuntimeProbes
$headroomCommand = Get-CommandInfo 'headroom'
$headroomBinaryPresent = $headroomCommand.Present -or (Test-Path -LiteralPath (Join-Path $HOME '.local\bin\headroom.exe') -PathType Leaf)
$headroomGood = $headroomBinaryPresent -and $headroom.Configured -and $headroom.Running
$headroomPartial = $headroomBinaryPresent -or $headroom.Configured
$headroomStatus = if ($SkipRuntimeProbes -and $headroomPartial) { 'UNKNOWN' } else { Get-Status $headroomGood $headroomPartial }
$headroomPort = if ($baseUrl) { try { ([Uri]$baseUrl).Port } catch { 'unknown' } } else { 'none' }
$headroomDetail = "installed=$($headroomBinaryPresent.ToString().ToLowerInvariant()) configured=$($headroom.Configured.ToString().ToLowerInvariant()) running=$($headroom.Running.ToString().ToLowerInvariant()) port=$headroomPort"
if ($headroom.StatusCode) { $headroomDetail += " http=$($headroom.StatusCode)" }
$components += [pscustomobject]@{ Name = 'headroom'; Status = $headroomStatus; Detail = $headroomDetail }

$result = [pscustomobject]@{
    directory = (Get-Location).Path
    profile = $profile
    harness = if ($claude.Present) { 'claude' } else { 'unknown' }
    model = Get-SafeModel
    components = $components
}

if ($Json) {
    $result | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

Write-Output "directory=$($result.directory)"
Write-Output "profile=$($result.profile)"
Write-Output "harness=$($result.harness)"
Write-Output "model=$($result.model)"
foreach ($component in $components) {
    Write-Output ("{0,-8} [{1,-7}] {2}" -f $component.Name, $component.Status, $component.Detail)
}
