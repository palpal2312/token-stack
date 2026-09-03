param(
    [int]$Port = 0,
    [string]$Upstream = $env:HEADROOM_UPSTREAM,
    [string]$DbPath = $env:HEADROOM_DB_PATH
)

if (-not $Upstream) { $Upstream = "http://127.0.0.1:9284" }
if (-not $DbPath) { $DbPath = "C:\Users\ADMIN\.codex\headroom-data\headroom.db" }

$headroom = "$HOME\.local\bin\headroom.exe"

function Test-TcpPortFree {
    param([int]$p)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Find-FreeHeadroomPort {
    param(
        [int]$Start = 8787,
        [int]$End = 9999
    )
    $assigned = @()
    $envFiles = Get-ChildItem -Path $HOME -Filter '.env*' -File -ErrorAction SilentlyContinue
    foreach ($f in $envFiles) {
        if ($f.Name -match '^\.env\.(claude-)?codex$') { continue }
        $content = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue
        foreach ($line in $content) {
            if ($line -match '^\s*HEADROOM_PORT\s*=\s*(\d+)') {
                $assigned += [int]$Matches[1]
            }
        }
    }
    for ($p = $Start; $p -le $End; $p++) {
        if ($assigned -notcontains $p -and (Test-TcpPortFree $p)) {
            return $p
        }
    }
    throw "No free port found in range $Start-$End"
}

if ($Port -le 0 -and $env:HEADROOM_PORT) {
    [int]::TryParse($env:HEADROOM_PORT, [ref]$Port) | Out-Null
}

if ($Port -gt 0) {
    $readyz = "http://127.0.0.1:$Port/readyz"
    try {
        $res = Invoke-WebRequest -Uri $readyz -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
            exit 0
        }
    } catch {}
    if (-not (Test-TcpPortFree $Port)) {
        $Port = Find-FreeHeadroomPort
    }
} else {
    $Port = Find-FreeHeadroomPort
}

$readyz = "http://127.0.0.1:$Port/readyz"
$dbDir = Split-Path $DbPath -Parent
if (-not (Test-Path -LiteralPath $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
}

$argList = @('proxy', '--port', $Port.ToString(), '--memory-db-path', $DbPath, '--anthropic-api-url', $Upstream, '--openai-api-url', $Upstream)
Start-Process -WindowStyle Hidden -FilePath $headroom -ArgumentList $argList

$i = 0
while ($i -lt 90) {
    try {
        $res = Invoke-WebRequest -Uri $readyz -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
            exit 0
        }
    } catch {}
    Start-Sleep -Seconds 1
    $i++
}
exit 0
