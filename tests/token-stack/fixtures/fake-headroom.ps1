[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [int]$Port = 0,

    [Parameter(Mandatory = $false)]
    [ValidateSet('ready', 'crash', 'hang', 'delayed-ready')]
    [string]$Mode = 'ready',

    [Parameter(Mandatory = $false)]
    [int]$DelaySeconds = 2
)

$ErrorActionPreference = 'Stop'

if ($Mode -eq 'crash') {
    [Console]::Error.WriteLine("Simulated early proxy crash.")
    exit 42
}

if ($Mode -eq 'hang') {
    while ($true) {
        Start-Sleep -Seconds 1
    }
}

if ($Mode -eq 'delayed-ready') {
    Start-Sleep -Seconds $DelaySeconds
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
$actualPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port

[Console]::Out.WriteLine("READY: Headroom proxy running on http://127.0.0.1:$actualPort/ (PID: $PID)")
[Console]::Out.Flush()

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
        $reqLine = $reader.ReadLine()
        $reqPath = ""
        if ($reqLine -match '^[A-Z]+\s+(\S+)') {
            $reqPath = $matches[1]
        }

        # Consume remaining request headers
        while ($true) {
            $h = $reader.ReadLine()
            if ($null -eq $h -or $h.Trim().Length -eq 0) { break }
        }

        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.Encoding]::ASCII)
        if ($reqPath -eq '/readyz') {
            $body = "ok"
            $writer.Write("HTTP/1.1 200 OK`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n$body")
        } else {
            $sse = "event: message_start`ndata: {}`n`n"
            $writer.Write("HTTP/1.1 200 OK`r`nContent-Type: text/event-stream`r`nContent-Length: $($sse.Length)`r`nConnection: close`r`n`r`n$sse")
        }
        $writer.Flush()
        $client.Close()
    }
} finally {
    $listener.Stop()
}
