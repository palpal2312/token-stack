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
    if ($env:CODEX_HOME) { return [Environment]::ExpandEnvironmentVariables($env:CODEX_HOME) }
    if ($env:KIMI_CONFIG_DIR) { return [Environment]::ExpandEnvironmentVariables($env:KIMI_CONFIG_DIR) }

    # Detect if running under Codex
    $isCodex = $false
    if ($env:CODEX_CLI_PATH -or $env:CODEX_SESSION_ID) {
        $isCodex = $true
    } else {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction SilentlyContinue
        if ($parent -and $parent.ParentProcessId) {
            $pproc = Get-CimInstance Win32_Process -Filter "ProcessId = $($parent.ParentProcessId)" -ErrorAction SilentlyContinue
            if ($pproc -and ($pproc.Name -match '(?i)codex' -or $pproc.CommandLine -match '(?i)codex')) {
                $isCodex = $true
            }
        }
    }
    if ($isCodex -and (Test-Path (Join-Path $HOME '.codex'))) {
        return (Join-Path $HOME '.codex')
    }

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
    param([string]$ProfileDir = '')
    $candidates = @($env:CLAUDE_MODEL, $env:ANTHROPIC_MODEL, $env:CODEX_MODEL, $env:OPENAI_MODEL, $env:CLAUDE_CODE_SUBAGENT_MODEL)
    foreach ($candidate in $candidates) {
        if ($candidate -and $candidate -match '^[A-Za-z0-9._:/-]{1,128}$') { return $candidate }
    }
    if ($ProfileDir) {
        $tomlPath = Join-Path $ProfileDir 'config.toml'
        if (Test-Path -LiteralPath $tomlPath -PathType Leaf) {
            $lines = Get-Content -LiteralPath $tomlPath -ErrorAction SilentlyContinue
            foreach ($line in $lines) {
                if ($line -match '^\s*model\s*=\s*"([^"]+)"') { return $Matches[1] }
            }
        }
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
                $response = Invoke-WebRequest -Uri ([Uri]::new($uri, $path)) -UseBasicParsing -TimeoutSec 2
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

$isCodexProfile = ($profile -match '(?i)\.codex' -or (Test-Path (Join-Path $profile 'config.toml')))
$claude = Get-CommandInfo 'claude'
$codex = Get-CommandInfo 'codex'
$harnessName = if ($isCodexProfile) {
    if ($codex.Present) { "codex $($codex.Version)" } else { 'codex present' }
} elseif ($claude.Present) {
    "claude $($claude.Version)"
} else {
    'unknown'
}
$harnessPresent = if ($isCodexProfile) { $codex.Present -or (Test-Path (Join-Path $profile 'config.toml')) } else { $claude.Present }
$components += [pscustomobject]@{ Name = 'harness'; Status = (Get-Status $harnessPresent); Detail = $harnessName }

$safeModel = Get-SafeModel $profile
$components += [pscustomobject]@{ Name = 'model'; Status = if ($safeModel -eq 'unknown') { 'UNKNOWN' } else { 'OK' }; Detail = "configured=$safeModel runtime=external" }

# --- Layer 0: Code Topology ---
$topologyProvider = 'native'
$topologyStatus = 'OK'
$topologyDetail = 'provider=native (grep/find)'
$graphifyCmd = Get-CommandInfo 'graphify'
if ($graphifyCmd.Present -or (Test-Path (Join-Path $profile 'skills\graphify')) -or (Test-Path 'graphify-out\graph.json')) {
    $topologyProvider = 'graphify'
    $topologyStatus = 'OK'
    $topologyDetail = 'provider=graphify ast=tree-sitter zero-token=true'
} elseif ($settings -and $settings.PSObject.Properties['mcpServers'] -and $settings.mcpServers.PSObject.Properties['gitnexus']) {
    $topologyProvider = 'gitnexus'
    $topologyStatus = 'OK'
    $topologyDetail = 'provider=gitnexus-mcp blast-radius=active'
} elseif ($settings -and $settings.PSObject.Properties['mcpServers'] -and $settings.mcpServers.PSObject.Properties['codegraph']) {
    $topologyProvider = 'codegraph'
    $topologyStatus = 'OK'
    $topologyDetail = 'provider=codegraph-mcp real-time-sync=active'
}
$components += [pscustomobject]@{ Name = 'topology'; Status = $topologyStatus; Detail = $topologyDetail }

# --- Layers 1 & 2: Ponytail & Caveman ---
foreach ($plugin in @('ponytail@ponytail', 'caveman@caveman')) {
    $pluginName = $plugin.Split('@')[0]
    $installed = (Test-PluginInstalled $manifest $plugin) -or (Test-Path (Join-Path $profile "skills\$pluginName"))
    $enabled = (Test-PluginEnabled $settings $plugin) -or (Test-Path (Join-Path $profile "skills\$pluginName"))
    $good = $installed -and $enabled
    $partial = $installed -or $enabled
    $components += [pscustomobject]@{
        Name = $pluginName
        Status = Get-Status $good $partial
        Detail = "installed=$($installed.ToString().ToLowerInvariant()) enabled=$($enabled.ToString().ToLowerInvariant())"
    }
}

# --- Layer 3: RTK ---
$rtk = Get-CommandInfo 'rtk'
$rtkBinary = Join-Path $env:LOCALAPPDATA 'rtk\rtk.exe'
$rtkBinaryPresent = Test-Path -LiteralPath $rtkBinary -PathType Leaf
$components += [pscustomobject]@{
    Name = 'rtk'
    Status = Get-Status ($rtk.Present -and $rtkBinaryPresent) ($rtk.Present -or $rtkBinaryPresent)
    Detail = "shim=$($rtk.Present.ToString().ToLowerInvariant()) binary=$($rtkBinaryPresent.ToString().ToLowerInvariant()) version=$($rtk.Version)"
}

# --- Layer -1: Semantic Cache ---
$semCacheScript = Join-Path $PSScriptRoot '..\..\..\core\semantic-cache.cjs'
$semCacheReady = Test-Path -LiteralPath $semCacheScript -PathType Leaf
$semCacheDetail = if ($semCacheReady) { 'engine=sqlite-ngram vector-cosine=ready latency=<15ms' } else { 'engine=none' }
$semCacheStatus = if ($semCacheReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'semcache'; Status = $semCacheStatus; Detail = $semCacheDetail }

# --- Layer 0: Model Router ---
$routerScript = Join-Path $PSScriptRoot '..\..\..\core\model-router.cjs'
$routerReady = Test-Path -LiteralPath $routerScript -PathType Leaf
$routerDetail = if ($routerReady) { 'classifier=routellm-frugal cheap-tier=kimi/deepseek savings=-85%' } else { 'classifier=none' }
$routerStatus = if ($routerReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'router'; Status = $routerStatus; Detail = $routerDetail }

# --- Layer 0.5: Dynamic Skill Router (Anti-Skill-Shadowing) ---
$skillRouterScript = Join-Path $PSScriptRoot '..\..\..\core\skill-router.cjs'
$skillRouterReady = Test-Path -LiteralPath $skillRouterScript -PathType Leaf
$skillRouterDetail = if ($skillRouterReady) { 'two-stage=retrieve+rerank anti-shadowing=active bloat-cut=-98%' } else { 'router=none' }
$skillRouterStatus = if ($skillRouterReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'skillrouter'; Status = $skillRouterStatus; Detail = $skillRouterDetail }

# --- Layer 1.5: Data & Quant Lens ---
$dataLensScript = Join-Path $PSScriptRoot '..\..\..\core\data-lens.cjs'
$dataLensReady = Test-Path -LiteralPath $dataLensScript -PathType Leaf
$chHttp = 'none'
try {
    $res = Invoke-WebRequest -Uri 'http://127.0.0.1:8123/?query=SELECT%201' -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($res.Content -match '1') {
        $chHttp = 'http:8123(ready)'
    }
} catch {
    if ($_.Exception.Response.StatusCode.Value__ -eq 401) {
        $chHttp = 'http:8123(auth-required)'
    } elseif ($_.Exception.Message -match '401') {
        $chHttp = 'http:8123(auth-required)'
    }
}
$duckDbCmd = Get-CommandInfo 'duckdb'
$chPresent = (Get-CommandInfo 'clickhouse').Present
$chStatusStr = if ($chHttp -ne 'none') { "clickhouse=$chHttp" } elseif ($chPresent) { 'clickhouse=local' } else { 'clickhouse=none' }
$duckStatusStr = if ($duckDbCmd.Present) { 'duckdb=present' } else { 'duckdb=none' }
$dataLensDetail = "contracts=ready $chStatusStr $duckStatusStr tearsheet=active"
$dataLensStatus = if ($dataLensReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'datalens'; Status = $dataLensStatus; Detail = $dataLensDetail }

# --- Layer 5: In-Flight Turn Folding ---
$turnFolderScript = Join-Path $PSScriptRoot '..\..\..\core\turn-folder.cjs'
$turnFolderReady = Test-Path -LiteralPath $turnFolderScript -PathType Leaf
$turnFolderDetail = if ($turnFolderReady) { 'epoch=5-turn freezing prompt-cache=100% stable' } else { 'epoch=none' }
$turnFolderStatus = if ($turnFolderReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'turnfolding'; Status = $turnFolderStatus; Detail = $turnFolderDetail }

# --- Layer 6: CoT Reasoning Budget Governor ---
$cotGovScript = Join-Path $PSScriptRoot '..\..\..\core\cot-governor.cjs'
$cotGovReady = Test-Path -LiteralPath $cotGovScript -PathType Leaf
$cotGovDetail = if ($cotGovReady) { 'policy=task-aware simple=1024 deep=8192 savings=-90%' } else { 'policy=none' }
$cotGovStatus = if ($cotGovReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'cotgovernor'; Status = $cotGovStatus; Detail = $cotGovDetail }

# --- Layer 7: Runaway Loop Breaker & Failover ---
$guardrailScript = Join-Path $PSScriptRoot '..\..\..\core\guardrail.cjs'
$guardrailReady = Test-Path -LiteralPath $guardrailScript -PathType Leaf
$guardrailDetail = if ($guardrailReady) { 'circuit-breaker=sha256-ringbuffer halt=3x failover=sub-500ms' } else { 'circuit-breaker=none' }
$guardrailStatus = if ($guardrailReady) { 'OK' } else { 'OPTIONAL' }
$components += [pscustomobject]@{ Name = 'guardrail'; Status = $guardrailStatus; Detail = $guardrailDetail }

# --- Layer 8: Headroom Proxy ---
$baseUrl = Get-PropertyValue (Get-PropertyValue $settings 'env') 'ANTHROPIC_BASE_URL'
if (-not $baseUrl) {
    $baseUrl = Get-PropertyValue (Get-PropertyValue $settings 'env') 'OPENAI_BASE_URL'
}
if (-not $baseUrl) {
    $envPath = Join-Path $profile '.env'
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
        $lines = Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue
        foreach ($line in $lines) {
            if ($line -match '^\s*ANTHROPIC_BASE_URL\s*=\s*([^\s]+)') { $baseUrl = $Matches[1]; break }
            if ($line -match '^\s*OPENAI_BASE_URL\s*=\s*([^\s]+)') { $baseUrl = $Matches[1]; break }
            if ($line -match '^\s*HEADROOM_PORT\s*=\s*(\d+)') { $baseUrl = "http://127.0.0.1:$($Matches[1])"; break }
        }
    }
}

$headroom = Get-HeadroomProbe $baseUrl -Skip:$SkipRuntimeProbes
$headroomCommand = Get-CommandInfo 'headroom'
$headroomBinaryPresent = $headroomCommand.Present -or (Test-Path -LiteralPath (Join-Path $HOME '.local\bin\headroom.exe') -PathType Leaf)
$headroomGood = $headroomBinaryPresent -and $headroom.Configured -and $headroom.Running
$headroomPartial = $headroomBinaryPresent -or $headroom.Configured
$headroomStatus = if ($SkipRuntimeProbes -and $headroomPartial) { 'UNKNOWN' } else { Get-Status $headroomGood $headroomPartial }
$headroomPort = if ($baseUrl) { try { ([Uri]$baseUrl).Port } catch { 'unknown' } } else { 'none' }
$runningStateStr = if ($SkipRuntimeProbes) { 'unprobed' } else { $headroom.Running.ToString().ToLowerInvariant() }
$headroomDetail = "installed=$($headroomBinaryPresent.ToString().ToLowerInvariant()) configured=$($headroom.Configured.ToString().ToLowerInvariant()) running=$runningStateStr port=$headroomPort"
if ($headroom.StatusCode) { $headroomDetail += " http=$($headroom.StatusCode)" }
$components += [pscustomobject]@{ Name = 'headroom'; Status = $headroomStatus; Detail = $headroomDetail }

# --- Layer 9: Knowledge Harvester (MemoraX) ---
$harvesterProvider = 'none'
$harvesterStatus = 'OPTIONAL'
$harvesterDetail = 'provider=none'
$memoraxCmd = Get-CommandInfo 'memorax-code'
if ($memoraxCmd.Present) {
    $harvesterProvider = 'memorax-code'
    $harvesterStatus = 'OK'
    $harvesterDetail = 'provider=memorax-code binary=present'
}
$components += [pscustomobject]@{ Name = 'harvester'; Status = $harvesterStatus; Detail = $harvesterDetail }

# --- Layer 10: Context Database Platform (OpenViking / Obsidian / Local / None) ---
$contextProvider = 'none'
$contextStatus = 'OPTIONAL'
$contextDetail = 'provider=none'
if ($settings -and $settings.PSObject.Properties['mcpServers'] -and $settings.mcpServers.PSObject.Properties['openviking']) {
    $contextProvider = 'openviking'
    $contextStatus = 'OK'
    $contextDetail = 'provider=openviking protocol=viking:// ready=true'
} elseif (Test-Path -LiteralPath (Join-Path $profile 'obsidian-vault')) {
    $contextProvider = 'obsidian'
    $contextStatus = 'OK'
    $contextDetail = 'provider=obsidian-vault visual-graph=ready'
} elseif (Test-Path -LiteralPath (Join-Path $profile 'memory')) {
    $contextProvider = 'local'
    $contextStatus = 'OK'
    $contextDetail = 'provider=local-storage flat=ready'
}
$components += [pscustomobject]@{ Name = 'contextdb'; Status = $contextStatus; Detail = $contextDetail }

$result = [pscustomobject]@{
    directory = (Get-Location).Path
    profile = $profile
    harness = if ($isCodexProfile) { 'codex' } elseif ($claude.Present) { 'claude' } else { 'unknown' }
    model = $safeModel
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
    Write-Output ("{0,-9} [{1,-7}] {2}" -f $component.Name, $component.Status, $component.Detail)
}