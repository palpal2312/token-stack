[CmdletBinding()]
param(
    [string]$ConfigDir,
    [string]$SourceRoot,
    [switch]$Human,
    [switch]$CheckProxy
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Resolve-SafePath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try {
        return [IO.Path]::GetFullPath($Path)
    } catch {
        return $Path
    }
}

function Get-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ state = 'missing'; value = $null; error = $null }
    }

    try {
        $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        $text = $text.TrimStart([char]0xFEFF)
        return [ordered]@{ state = 'valid'; value = ($text | ConvertFrom-Json -ErrorAction Stop); error = $null }
    } catch {
        return [ordered]@{ state = 'invalid'; value = $null; error = $_.Exception.Message }
    }
}

function Get-CommandState([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [ordered]@{ present = $false; path = $null }
    }
    return [ordered]@{ present = $true; path = [string]$command.Source }
}

function Get-FileState([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ state = 'missing'; path = $Path; sha256 = $null }
    }
    try {
        return [ordered]@{ state = 'present'; path = $Path; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
    } catch {
        return [ordered]@{ state = 'unreadable'; path = $Path; sha256 = $null }
    }
}

function ConvertTo-SafeUrl([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try {
        $uri = [Uri]$Value
        if (-not $uri.IsAbsoluteUri) { return '[redacted-url]' }
        $builder = New-Object System.UriBuilder($uri)
        $builder.UserName = ''
        $builder.Password = ''
        $builder.Query = ''
        $builder.Fragment = ''
        return $builder.Uri.AbsoluteUri.TrimEnd('/')
    } catch {
        return '[redacted-url]'
    }
}

function Get-UrlHost([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try { return ([Uri]$Value).Host } catch { return $null }
}

function Get-UrlPort([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try { return ([Uri]$Value).Port } catch { return $null }
}

function Test-UrlEqual([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    return ((ConvertTo-SafeUrl $Left) -eq (ConvertTo-SafeUrl $Right))
}

function Add-Action([System.Collections.ArrayList]$Actions, [string]$Id, [int]$Priority, [string]$Reason, [string]$Evidence) {
    [void]$Actions.Add([ordered]@{
        id = $Id
        priority = $Priority
        status = 'recommended'
        reason = $Reason
        evidence = $Evidence
    })
}

function Get-HealthSnapshot([int]$Port) {
    $empty = [ordered]@{
        checked = $false
        state = 'not_checked'
        url = "http://127.0.0.1:$Port/health"
        ready = $null
        upstreamStatus = $null
        upstream = $null
        error = $null
    }
    try {
        $health = Invoke-RestMethod -Uri $empty.url -Method Get -TimeoutSec 3 -ErrorAction Stop
        $ready = $null
        if ($health.PSObject.Properties.Name -contains 'ready') { $ready = [bool]$health.ready }
        $upstreamStatus = $null
        $liveUpstream = $null
        if ($null -ne $health.checks -and $null -ne $health.checks.upstream) {
            if ($health.checks.upstream.PSObject.Properties.Name -contains 'status') { $upstreamStatus = [string]$health.checks.upstream.status }
            if ($health.checks.upstream.PSObject.Properties.Name -contains 'url') { $liveUpstream = [string]$health.checks.upstream.url }
        }
        if ([string]::IsNullOrWhiteSpace($liveUpstream) -and $null -ne $health.config -and $null -ne $health.config.anthropic_api_url) {
            $liveUpstream = [string]$health.config.anthropic_api_url
        }
        $state = if ($ready -eq $true -and ($null -eq $upstreamStatus -or $upstreamStatus -eq 'healthy')) { 'ready' } elseif ($ready -eq $false) { 'not_ready' } else { 'degraded' }
        return [ordered]@{
            checked = $true
            state = $state
            url = $empty.url
            ready = $ready
            upstreamStatus = $upstreamStatus
            upstream = ConvertTo-SafeUrl $liveUpstream
            error = $null
            rawUpstream = $liveUpstream
        }
    } catch {
        $empty.error = $_.Exception.GetType().Name
        return $empty
    }
}

function Get-StatsSnapshot([int]$Port) {
    $empty = [ordered]@{ checked = $false; state = 'not_checked'; requests = $null; savedTokens = $null; agents = @(); error = $null }
    try {
        $stats = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/stats" -Method Get -TimeoutSec 3 -ErrorAction Stop
        $requests = $null
        if ($null -ne $stats.agent_usage -and $null -ne $stats.agent_usage.totals -and $stats.agent_usage.totals.PSObject.Properties.Name -contains 'requests') {
            $requests = [int64]$stats.agent_usage.totals.requests
        } elseif ($null -ne $stats.summary -and $stats.summary.PSObject.Properties.Name -contains 'api_requests') {
            $requests = [int64]$stats.summary.api_requests
        }
        $saved = $null
        foreach ($container in @($stats.summary, $stats.compression, $stats)) {
            if ($null -ne $container -and $container.PSObject.Properties.Name -contains 'total_tokens_saved_all_layers') {
                $saved = [int64]$container.total_tokens_saved_all_layers
                break
            }
        }
        $agents = @()
        if ($null -ne $stats.agent_usage) {
            if ($stats.agent_usage.PSObject.Properties.Name -contains 'agents') {
                $agents = @($stats.agent_usage.agents | ForEach-Object { [string]$_.agent })
            } else {
                $agents = @($stats.agent_usage.PSObject.Properties.Name | Where-Object { $_ -notin @('totals', 'summary') })
            }
        }
        return [ordered]@{ checked = $true; state = 'available'; requests = $requests; savedTokens = $saved; agents = @($agents | Select-Object -Unique); error = $null }
    } catch {
        $empty.error = $_.Exception.GetType().Name
        return $empty
    }
}

$explicitConfig = -not [string]::IsNullOrWhiteSpace($ConfigDir)
$configSource = if ($explicitConfig) { 'parameter' } elseif (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CONFIG_DIR)) { 'environment' } else { 'default' }
$requestedConfig = if ($explicitConfig) { $ConfigDir } elseif (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CONFIG_DIR)) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$profilePath = Resolve-SafePath $requestedConfig
$settingsPath = Join-Path $profilePath 'settings.json'
$settingsResult = Get-JsonFile $settingsPath
$settings = $settingsResult.value

$sourceCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($SourceRoot)) { $sourceCandidates += $SourceRoot }
if (-not [string]::IsNullOrWhiteSpace($env:TOKEN_STACK_ROOT)) { $sourceCandidates += $env:TOKEN_STACK_ROOT }
if (-not [string]::IsNullOrWhiteSpace($PWD.Path)) { $sourceCandidates += $PWD.Path }
$scriptRoot = Resolve-SafePath (Join-Path $PSScriptRoot '..')
$sourceCandidates += $scriptRoot
$sourceRootPath = $null
foreach ($candidate in $sourceCandidates) {
    $candidatePath = Resolve-SafePath $candidate
    if ((Test-Path (Join-Path $candidatePath 'skills\token-stack\SKILL.md') -PathType Leaf) -and (Test-Path (Join-Path $candidatePath 'scripts\headroom-ensure.sh') -PathType Leaf)) {
        $sourceRootPath = $candidatePath
        break
    }
}
$sourceSkillPath = if ($null -ne $sourceRootPath) { Join-Path $sourceRootPath 'skills\token-stack\SKILL.md' } else { $null }
$sourceHookPath = if ($null -ne $sourceRootPath) { Join-Path $sourceRootPath 'scripts\headroom-ensure.sh' } else { $null }
$installedSkillPath = Join-Path $profilePath 'skills\token-stack\SKILL.md'
$installedHookPath = Join-Path $profilePath 'hooks\headroom-ensure.sh'
$skillSource = Get-FileState $sourceSkillPath
$skillInstalled = Get-FileState $installedSkillPath
$hookSource = Get-FileState $sourceHookPath
$hookInstalled = Get-FileState $installedHookPath

$settingsSecretKeys = @()
$settingsBaseUrl = $null
$settingsModel = $null
$enabledPlugins = [ordered]@{ 'caveman@caveman' = $false; 'ponytail@ponytail' = $false }
$sessionEntries = @()
if ($null -ne $settings) {
    if ($settings.PSObject.Properties.Name -contains 'env' -and $null -ne $settings.env) {
        $settingsSecretKeys = @($settings.env.PSObject.Properties.Name | Where-Object { $_ -match '(?i)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)' })
        if ($settings.env.PSObject.Properties.Name -contains 'ANTHROPIC_BASE_URL') { $settingsBaseUrl = [string]$settings.env.ANTHROPIC_BASE_URL }
        if ($settings.env.PSObject.Properties.Name -contains 'ANTHROPIC_MODEL') { $settingsModel = [string]$settings.env.ANTHROPIC_MODEL }
    }
    if ($settings.PSObject.Properties.Name -contains 'enabledPlugins' -and $null -ne $settings.enabledPlugins) {
        foreach ($plugin in @($enabledPlugins.Keys)) {
            if ($settings.enabledPlugins.PSObject.Properties.Name -contains $plugin) { $enabledPlugins[$plugin] = [bool]$settings.enabledPlugins.$plugin }
        }
    }
    if ($settings.PSObject.Properties.Name -contains 'hooks' -and $null -ne $settings.hooks -and $settings.hooks.PSObject.Properties.Name -contains 'SessionStart' -and $null -ne $settings.hooks.SessionStart) { $sessionEntries = @($settings.hooks.SessionStart) }
}

$hookMetadata = [ordered]@{ found = $false; matcher = $null; profilePathMatch = $false; path = $installedHookPath; port = $null; upstream = $null; timeout = $null; commandKind = $null }
foreach ($entry in $sessionEntries) {
    foreach ($hook in @($entry.hooks)) {
        $command = if ($hook.PSObject.Properties.Name -contains 'command') { [string]$hook.command } else { '' }
        $argsStr = if ($hook.PSObject.Properties.Name -contains 'args' -and $hook.args) { ($hook.args -join ' ') } else { '' }
        $fullCmd = "$command $argsStr".Trim()
        if ($fullCmd -notmatch '(?i)headroom-ensure\.sh') { continue }
        $hookMetadata.found = $true
        $hookMetadata.matcher = [string]$entry.matcher
        $hookMetadata.commandKind = 'profile-headroom'
        if ($command -match 'HEADROOM_PORT\s*=\s*(\d+)') { $hookMetadata.port = [int]$Matches[1] }
        if ($command -match 'HEADROOM_UPSTREAM\s*=\s*([^\s]+)') { $hookMetadata.upstream = ConvertTo-SafeUrl $Matches[1] }
        if ($hook.PSObject.Properties.Name -contains 'timeout') { $hookMetadata.timeout = [int]$hook.timeout }
        $targetScript = $null
        if ($command -match '(?i)sh\s+"([^"]*headroom-ensure\.sh)"') {
            $targetScript = $Matches[1]
        } elseif ($hook.PSObject.Properties.Name -contains 'args' -and $hook.args) {
            foreach ($arg in @($hook.args)) {
                if ($arg -match '(?i)headroom-ensure\.sh') { $targetScript = [string]$arg; break }
            }
        }
        if ($null -ne $targetScript) {
            $expanded = $targetScript -replace '(?i)\$HOME', $HOME -replace '^~', $HOME
            $expanded = [Environment]::ExpandEnvironmentVariables($expanded)
            $hookPath = Resolve-SafePath ($expanded -replace '/', '\\')
            $hookMetadata.profilePathMatch = ($hookPath -eq (Resolve-SafePath $installedHookPath))
        }
        break
    }
    if ($hookMetadata.found) { break }
}

$processBaseUrl = if (-not [string]::IsNullOrWhiteSpace($env:ANTHROPIC_BASE_URL)) { [string]$env:ANTHROPIC_BASE_URL } else { $null }
$effectiveBaseUrl = if ($null -ne $processBaseUrl) { $processBaseUrl } else { $settingsBaseUrl }
$baseUrlSource = if ($null -ne $processBaseUrl) { 'process' } elseif ($null -ne $settingsBaseUrl) { 'settings' } else { 'missing' }
$baseUrlMismatch = ($null -ne $processBaseUrl -and $null -ne $settingsBaseUrl -and -not (Test-UrlEqual $processBaseUrl $settingsBaseUrl))
$baseUrlClassification = if ($null -eq $effectiveBaseUrl) { 'missing' } elseif ((Get-UrlHost $effectiveBaseUrl) -in @('127.0.0.1', 'localhost')) { 'local' } else { 'direct' }

$pluginMetadataPath = Join-Path $profilePath 'plugins\installed_plugins.json'
$pluginMetadataResult = Get-JsonFile $pluginMetadataPath
$installedPlugins = [ordered]@{ 'caveman@caveman' = $false; 'ponytail@ponytail' = $false }
if ($null -ne $pluginMetadataResult.value -and $pluginMetadataResult.value.PSObject.Properties.Name -contains 'plugins' -and $null -ne $pluginMetadataResult.value.plugins) {
    foreach ($plugin in @($installedPlugins.Keys)) {
        $installedPlugins[$plugin] = ($pluginMetadataResult.value.plugins.PSObject.Properties.Name -contains $plugin)
    }
}

$port = if ($null -ne $hookMetadata.port) { $hookMetadata.port } else { 8787 }
$health = if ($CheckProxy) { Get-HealthSnapshot $port } else { [ordered]@{ checked = $false; state = 'not_checked'; url = "http://127.0.0.1:$port/health"; ready = $null; upstreamStatus = $null; upstream = $null; error = $null } }
$stats = if ($CheckProxy -and $health.checked) { Get-StatsSnapshot $port } else { [ordered]@{ checked = $false; state = 'not_checked'; requests = $null; savedTokens = $null; agents = @(); error = $null } }
$liveUpstreamRaw = if ($health.Contains('rawUpstream')) { $health.rawUpstream } else { $null }
$health.Remove('rawUpstream')
$routeStatus = if ($baseUrlMismatch) { 'process_override' } elseif (-not $CheckProxy) { 'unchecked' } elseif (-not $health.checked) { 'unavailable' } elseif ($null -ne $hookMetadata.upstream -and $null -ne $liveUpstreamRaw -and -not (Test-UrlEqual $hookMetadata.upstream $liveUpstreamRaw)) { 'stale_upstream' } elseif ($health.state -eq 'ready' -and $baseUrlClassification -eq 'local') { 'ok' } elseif ($baseUrlClassification -eq 'direct') { 'bypassed' } else { 'unknown' }

$actions = New-Object System.Collections.ArrayList
$errors = New-Object System.Collections.ArrayList
if ($settingsResult.state -eq 'invalid') {
    [void]$errors.Add('settings_json_invalid')
    Add-Action $actions 'inspect-invalid-settings' 1 'settings.json cannot be parsed' 'settings_state=invalid'
} elseif ($settingsResult.state -eq 'missing') {
    Add-Action $actions 'inspect-missing-settings' 1 'profile settings.json is missing' 'settings_state=missing'
}
if ($null -eq $sourceRootPath) {
    Add-Action $actions 'locate-source-root' 1 'source token-stack repository not found' 'source_state=missing'
} elseif ($skillInstalled.state -ne 'present' -or $skillSource.sha256 -ne $skillInstalled.sha256) {
    Add-Action $actions 'update-profile-skill' 2 'installed skill is missing or differs from source' "source=$($skillSource.state);installed=$($skillInstalled.state)"
}
if ($hookInstalled.state -ne 'present') {
    Add-Action $actions 'create-profile-hook' 2 'profile-local headroom hook is missing' "hook=$installedHookPath"
} elseif (-not $hookMetadata.found -or -not $hookMetadata.profilePathMatch) {
    Add-Action $actions 'register-profile-hook' 2 'SessionStart does not point to profile-local headroom hook' 'hook_registration=mismatch'
}
foreach ($plugin in @($enabledPlugins.Keys)) {
    $pluginName = $plugin -replace '@.*',''
    if (-not $enabledPlugins[$plugin]) { Add-Action $actions ("enable-$pluginName") 3 "required plugin is disabled: $plugin" 'enabled=false' }
    if (-not $installedPlugins[$plugin]) { Add-Action $actions ("install-$pluginName") 3 "required plugin is not present in profile metadata: $plugin" 'installed=false' }
}
if ($baseUrlClassification -ne 'local') { Add-Action $actions 'set-proxy-base-url' 3 'effective Anthropic base URL does not use local headroom proxy' "classification=$baseUrlClassification" }
if ($baseUrlMismatch) { Add-Action $actions 'remove-process-route-override' 2 'process environment overrides profile settings base URL' 'base_url_source=process' }
if ($routeStatus -eq 'stale_upstream') { Add-Action $actions 'inspect-stale-upstream' 1 'ready proxy upstream differs from profile hook upstream; upstream is baked at process start' 'route_status=stale_upstream' }
if ($CheckProxy -and $routeStatus -eq 'unavailable') { Add-Action $actions 'start-or-check-headroom' 2 'headroom health endpoint is unavailable' 'proxy_state=unavailable' }
if ($CheckProxy -and $stats.state -eq 'available' -and $stats.requests -eq 0) { Add-Action $actions 'verify-real-routing' 4 'proxy has no recorded agent requests yet' 'stats_requests=0' }
if ($actions.Count -eq 0) { Add-Action $actions 'no-action' 9 'profile state matches detected source and configured checks' 'state=ok' } else { Add-Action $actions 'restart-session-after-repair' 8 'restart only after applying recommended profile changes' 'settings_or_skill_changes=require_restart' }

$tools = [ordered]@{ claude = Get-CommandState 'claude'; kimi = Get-CommandState 'kimi'; codex = Get-CommandState 'codex'; agy = Get-CommandState 'agy'; rtk = Get-CommandState 'rtk'; headroom = Get-CommandState 'headroom' }
$harnessCandidates = @()
if ($env:CLAUDECODE -or (Get-Process -Name 'claude','claude-code' -ErrorAction SilentlyContinue)) { $harnessCandidates += 'Claude Code' }
if ($env:KIMI_CODE -or (Get-Process -Name 'kimi','kimi-code' -ErrorAction SilentlyContinue)) { $harnessCandidates += 'Kimi Code' }
if ($env:CODEX_HOME -or (Get-Process -Name 'codex' -ErrorAction SilentlyContinue)) { $harnessCandidates += 'Codex' }
if ($env:AGY_HOME -or (Get-Process -Name 'agy','antigravity' -ErrorAction SilentlyContinue)) { $harnessCandidates += 'Agy/Antigravity' }

$result = [ordered]@{
    schema = 'token-stack.detect/v1'
    version = 1
    mode = if ($Human) { 'human' } else { 'json' }
    ok = ($settingsResult.state -ne 'invalid')
    profile = [ordered]@{ requestedPath = $requestedConfig; effectivePath = $profilePath; source = $configSource; envPath = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { $null }; name = (Split-Path $profilePath -Leaf); harnessCandidates = @($harnessCandidates) }
    settings = [ordered]@{ path = $settingsPath; state = $settingsResult.state; baseUrl = [ordered]@{ requested = ConvertTo-SafeUrl $settingsBaseUrl; effective = ConvertTo-SafeUrl $effectiveBaseUrl; source = $baseUrlSource; mismatch = $baseUrlMismatch; classification = $baseUrlClassification }; model = $settingsModel; secretEnvKeys = @($settingsSecretKeys) }
    source = [ordered]@{ root = $sourceRootPath; skill = $skillSource; hook = $hookSource }
    skill = [ordered]@{ source = $skillSource; installed = $skillInstalled; drift = ($skillSource.sha256 -ne $null -and $skillSource.sha256 -ne $skillInstalled.sha256) }
    hook = [ordered]@{ source = $hookSource; installed = $hookInstalled; sessionStart = $hookMetadata }
    plugins = [ordered]@{ required = @('caveman@caveman', 'ponytail@ponytail'); enabled = $enabledPlugins; installed = $installedPlugins; metadata = [ordered]@{ path = $pluginMetadataPath; state = $pluginMetadataResult.state } }
    tools = $tools
    proxy = [ordered]@{ port = $port; routeStatus = $routeStatus; health = $health; stats = $stats }
    actions = @($actions)
    errors = @($errors)
}

if ($Human) {
    Write-Output "profile=$($result.profile.effectivePath)"
    Write-Output "settings=$($result.settings.state) base_url=$($result.settings.baseUrl.effective) route=$($result.proxy.routeStatus)"
    Write-Output "skill=$($result.skill.installed.state) drift=$($result.skill.drift) hook=$($result.hook.sessionStart.found)"
    Write-Output "plugins=caveman:$($result.plugins.enabled.'caveman@caveman') ponytail:$($result.plugins.enabled.'ponytail@ponytail')"
    Write-Output "actions=$((@($result.actions) | ForEach-Object { $_.id }) -join ',')"
} else {
    Write-Output ($result | ConvertTo-Json -Depth 12 -Compress)
}

exit 0
