$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$here\..\lib\run-s17-runtime.ps1"

Describe 'S17 native runner helpers' {
    $repoRoot = Split-Path (Split-Path $here -Parent) -Parent

    It 'resolves the repository from the direct parent of scripts' {
        (Get-S17RepositoryRoot -ScriptDirectory (Join-Path $repoRoot 'scripts')) | Should Be $repoRoot
    }

    It 'rejects a directory that is not an S17 repository root' {
        { Assert-S17RepositoryLayout -RepositoryRoot $env:TEMP } | Should Throw
    }

    It 'rejects fake repository sentinels without a real Git top level' {
        $fake = Join-Path $TestDrive 'fake-repo'
        New-Item -ItemType Directory -Force (Join-Path $fake 'go') | Out-Null
        New-Item -ItemType Directory -Force (Join-Path $fake '.git') | Out-Null
        New-Item -ItemType File -Force (Join-Path $fake 'package.json') | Out-Null
        { Assert-S17RepositoryLayout -RepositoryRoot $fake } | Should Throw
    }

    It 'accepts an immediate healthy response without sleeping' {
        (Wait-S17Healthz -DaemonUrl 'http://127.0.0.1:3979' -TimeoutSeconds 1 -Probe { param($url) '200' }) | Should Be $true
    }

    It 'creates the daemon output directory before a first build' {
        $target = Join-Path $TestDrive 'go\bin'
        Ensure-S17DaemonDirectory -Directory $target
        (Test-Path $target) | Should Be $true
    }

    It 'stops only the recorded daemon process id' {
        Mock Stop-Process {}
        $process = [pscustomobject]@{ Id = 4242; HasExited = $false }
        Stop-S17Daemon -Process $process
        Assert-MockCalled Stop-Process -ParameterFilter { $Id -eq 4242 } -Times 1 -Exactly
    }

    It 'does not stop an already exited daemon process' {
        Mock Stop-Process {}
        Stop-S17Daemon -Process ([pscustomobject]@{ Id = 4242; HasExited = $true })
        Assert-MockCalled Stop-Process -Times 0 -Exactly -Scope It
    }

    It 'restores an unset environment variable by removing it' {
        Remove-Item Env:S17_RUNTIME_TEST_VALUE -ErrorAction SilentlyContinue
        Restore-S17EnvironmentVariable -Name 'S17_RUNTIME_TEST_VALUE' -Value $null
        (Test-Path Env:S17_RUNTIME_TEST_VALUE) | Should Be $false
    }

    It 'keeps desktop shell off unless -Shell is supplied' {
        $source = Get-Content -Raw (Join-Path $repoRoot 'scripts\run-s17.ps1')
        $source | Should Match 'Remove-Item Env:DESKTOP_SHELL_V2'
        $source | Should Match 'if \(\$Shell'
    }

    It 'runs a real bounded daemon health check against a disposable store' {
        $port = 3981
        $store = Join-Path $TestDrive 'sen-plane-store'
        $runner = Join-Path $repoRoot 'scripts\run-s17.ps1'
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $runner -Mode Native -HealthCheckOnly -DaemonUrl "http://127.0.0.1:$port" -StoreDir $store -ReadinessTimeoutSeconds 30 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'sen-plane pid='
        (Test-Path $store) | Should Be $true
        (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) | Should BeNullOrEmpty
    }
}
