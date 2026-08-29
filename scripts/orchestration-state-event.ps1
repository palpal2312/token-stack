# S09-C9 controller-only writer helper for the orchestration state journal.
#
# Appends ONE JSONL event to the append-only state journal after validating
# the transition against the allowed state machine and the redaction rules.
# The dashboard API is read-only; writes happen ONLY here, and ONLY when
# ORCHESTRATION_CONTROLLER=1 is set. Never include prompts, terminal output,
# credentials/capability material, or source/diff content in -Summary.
#
# Examples:
#   $env:ORCHESTRATION_CONTROLLER = "1"
#   .\scripts\orchestration-state-event.ps1 -Lane community -Task S09-C1-COMMUNITY-INTAKE -Transition QUEUED -Summary "intake lane queued"
#   .\scripts\orchestration-state-event.ps1 -Lane snapshot-return -Transition WAITING_ON -Prerequisite "I5 receipt and master-byte re-pin" -Summary "promotion landed; receipt pending"
#
# Protocol for a one-GET picture (token-cheap for the master):
#   - Lane start/hold/end + lane memo: append events here; the -Summary is the
#     lane's memo and shows on its card.
#   - Master fills "CURRENTLY SITUATION" / "HOW TO CLOSE THIS SPRINT" via:
#     Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3740/api/orchestration/note `
#       -ContentType 'application/json' `
#       -Body (@{ text = "sprint status line"; field = "situation" } | ConvertTo-Json)
#   - Read everything in ONE call: GET http://127.0.0.1:3740/api/orchestration/state
#     returns lanes + events + sprint roadmap + notes + lastWrite (who wrote last).
#
# Writer identity + queueing:
#   - -Writer names who appends (redacted label, never an account/secret);
#     defaults to $env:ORCHESTRATION_WRITER, then "controller".
#   - Concurrent writers queue on an atomic mkdir lock (<journal>.lock) around
#     read-validate-append; stale locks (>10s) are reclaimed. Same lock as the
#     node-side writers, so PS and API writers serialize on one journal.
#
# Local preview (dashboard, read-only, 127.0.0.1:3740) using the seed fixture:
#   $preview = "$PWD/qa/fixtures/orchestration-state/preview-home"
#   New-Item -ItemType Directory -Force $preview | Out-Null
#   Copy-Item qa/fixtures/orchestration-state/seed.jsonl "$preview/orchestration-state.jsonl" -Force
#   $env:AGENTIC_OS_HOME = $preview
#   npx next dev -H 127.0.0.1 -p 3740
#   (Ctrl+C to stop; the dev server must not be left running)

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Lane,
  [Parameter(Mandatory = $true)][string]$Task,
  [Parameter(Mandatory = $true)][ValidateSet("QUEUED", "DISPATCHED", "RUNNING", "WAITING_ON", "DONE", "BLOCKED", "FAILED", "IDLE", "HOLD_INTERNAL", "HOLD_LANE", "HOLD_APPROVAL", "HOLD_TIME")][string]$Transition,
  [Parameter(Mandatory = $true)][string]$Summary,
  [switch]$Lifecycle,
  [string]$Prerequisite,
  [string]$EvidencePath,
  [string]$EvidenceSha256,
  [string]$Time,
  [string]$StateFile,
  [string]$Writer
)

$ErrorActionPreference = 'Stop'

if ($env:ORCHESTRATION_CONTROLLER -ne '1') {
  Write-Host "controller-only writer: set ORCHESTRATION_CONTROLLER=1"
  exit 2
}

# Mirror of the state machine in src/lib/orchestration-state.ts. Keep in sync.
$allowed = @{
  QUEUED     = @('DISPATCHED')
  DISPATCHED = @('RUNNING', 'WAITING_ON')
  RUNNING    = @('WAITING_ON', 'DONE', 'BLOCKED', 'FAILED')
  WAITING_ON = @('RUNNING', 'DONE', 'BLOCKED', 'FAILED')
  DONE       = @()
  BLOCKED    = @()
  FAILED     = @()
}
$terminal = @('DONE', 'BLOCKED', 'FAILED')

if ($Summary.Length -gt 200) { Write-Host 'summary exceeds 200 characters'; exit 2 }
$forbidden = @('prompt', 'conversation', 'user story', 'raw log', 'terminal', 'secret', 'credential', 'private key', 'api key', 'password', 'bearer', 'source code', 'diff', '-----begin', '```')
foreach ($marker in $forbidden) {
  if ($Summary.ToLowerInvariant().Contains($marker)) {
    Write-Host "summary contains a forbidden marker: $marker"
    exit 2
  }
}

if (-not $Time) { $Time = (Get-Date).ToUniversalTime().ToString('o') }
if ((-not $EvidencePath) -xor (-not $EvidenceSha256)) {
  Write-Host 'evidence path and sha256 must be provided together'
  exit 2
}
if ($EvidenceSha256 -and $EvidenceSha256 -notmatch '^[a-f0-9]{64}$') {
  Write-Host 'evidenceSha256 must be a 64-char hex SHA-256'
  exit 2
}

if (-not $StateFile) {
  # $HOME is a read-only automatic variable; use $baseDir for the journal root.
  $baseDir = if ($env:AGENTIC_OS_HOME) { $env:AGENTIC_OS_HOME } else { Join-Path $HOME '.agentic-os' }
  $StateFile = Join-Path $baseDir 'orchestration-state.jsonl'
}
$dir = Split-Path -Parent $StateFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$writerName = if ($Writer) { $Writer } elseif ($env:ORCHESTRATION_WRITER) { $env:ORCHESTRATION_WRITER } else { 'controller' }
if ($writerName.Length -gt 64) { Write-Host 'writer exceeds 64 characters'; exit 2 }

# Writer queue: atomic mkdir lock around read-validate-append, so two agents
# appending at once serialize instead of interleaving (mirrors journal-lock.ts).
$lock = "$StateFile.lock"
$deadline = (Get-Date).AddSeconds(5)
while ($true) {
  try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null; break }
  catch {
    if (Test-Path $lock) {
      $ageSeconds = ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds
      if ($ageSeconds -gt 10) {
        # Holder crashed without releasing; reclaim the stale lock and retry.
        Remove-Item $lock -Recurse -Force -ErrorAction SilentlyContinue
        continue
      }
    }
    if ((Get-Date) -ge $deadline) {
      Write-Host 'writer queue timeout: another writer holds the journal lock'
      exit 2
    }
    Start-Sleep -Milliseconds 50
  }
}

try {

$current = $null
if (Test-Path $StateFile) {
  foreach ($line in Get-Content $StateFile) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $event = $line | ConvertFrom-Json
    if ($event.lane -eq $Lane) { $current = $event.transition }
  }
}

if ($Lifecycle) {
  # Lane lifecycle machine (IDLE -> DISPATCHED (Orca called) -> RUNNING (working)
  # -> HOLD_x/DONE, hold resumes to RUNNING).
  if ($Lane -notin @('lane-a', 'lane-b', 'lane-c')) {
    Write-Host "-Lifecycle requires a lane id: lane-a | lane-b | lane-c"; exit 2
  }
  $lifecycleAllowed = @{
    IDLE             = @('RUNNING', 'DISPATCHED')
    DISPATCHED       = @('RUNNING', 'DONE', 'HOLD_INTERNAL', 'HOLD_LANE', 'HOLD_APPROVAL', 'HOLD_TIME')
    RUNNING          = @('DONE', 'HOLD_INTERNAL', 'HOLD_LANE', 'HOLD_APPROVAL', 'HOLD_TIME')
    HOLD_INTERNAL    = @('RUNNING', 'DONE')
    HOLD_LANE        = @('RUNNING', 'DONE')
    HOLD_APPROVAL    = @('RUNNING', 'DONE')
    HOLD_TIME        = @('RUNNING', 'DONE')
    DONE             = @('RUNNING')
  }
  if ($null -eq $current) {
    if ($Transition -notin @('IDLE', 'RUNNING', 'DISPATCHED')) { Write-Host "first lifecycle event must be IDLE, RUNNING or DISPATCHED, got $Transition"; exit 2 }
  } elseif ($lifecycleAllowed[$current] -notcontains $Transition) {
    Write-Host "invalid lane transition $current -> $Transition"
    exit 2
  }
} else {
  if ($null -eq $current) {
    if ($Transition -ne 'QUEUED') { Write-Host "first event for a lane must be QUEUED, got $Transition"; exit 2 }
  } else {
    if ($terminal -contains $current) { Write-Host "lane is terminal ($current); no further transitions allowed"; exit 2 }
    if ($allowed[$current] -notcontains $Transition) {
      Write-Host "invalid transition $current -> $Transition"
      exit 2
    }
  }
}

$line = @{
  lane        = $Lane
  task        = $Task
  transition  = $Transition
  time        = $Time
  summary     = $Summary
  writer      = $writerName
  prerequisite  = $(if ($Prerequisite) { $Prerequisite } else { $null })
  evidencePath  = $(if ($EvidencePath) { $EvidencePath } else { $null })
  evidenceSha256 = $(if ($EvidenceSha256) { $EvidenceSha256 } else { $null })
}

$json = $line | ConvertTo-Json -Compress
Add-Content -Path $StateFile -Value $json -Encoding utf8
Write-Output "appended: $Lane -> $Transition (writer $writerName) at $StateFile"

} finally {
  Remove-Item $lock -Recurse -Force -ErrorAction SilentlyContinue
}