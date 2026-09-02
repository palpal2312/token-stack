# Note writer for the orchestration dashboard cards.
#
# Appends ONE JSONL note to the append-only notes journal
# (~/.agentic-os/orchestration-notes.jsonl). The dashboard API is read-only;
# notes are written ONLY here. Notes are display annotations, not state
# authority — the state machine journal stays controller-gated.
#
# Fields (fill the card boxes):
#   -Field situation  -> MASTER card "CURRENTLY SITUATION"
#   -Field close      -> MASTER card "HOW TO CLOSE THIS SPRINT"
#   -Field run  -Lane <lane-name>  -> lane/tab card "Last run journal"
#   -Field next -Lane <lane-name>  -> lane/tab card "Next action / Block"
# Naming a terminal handle (term_xxx) in -Text also pins a DECLARED badge on
# that exact tab card.
#
# Examples:
#   .\scripts\orchestration-note.ps1 -Field situation -Text "takeover active at tab term_abc123 (Codex), sprint 10"
#   .\scripts\orchestration-note.ps1 -Field run -Lane "ORCHESTATION PAGE" -Text "receipt f4351c2 verified"
#
# Never include prompts, transcripts, credentials/capability material, or
# source/diff content in -Text. Max 200 chars.

param(
  [Parameter(Mandatory=$true)][ValidateSet("situation","close","run","next")][string]$Field,
  [Parameter(Mandatory=$true)][string]$Text,
  [string]$Lane,
  [string]$Writer = "agent"
)

$ErrorActionPreference = "Stop"

if (($Field -eq "run" -or $Field -eq "next") -and -not $Lane) {
  Write-Error "run/next notes need -Lane <lane-name>"
  exit 1
}
if ($Text.Trim().Length -eq 0 -or $Text.Length -gt 200) {
  Write-Error "Text must be 1-200 characters"
  exit 1
}
$forbidden = @("prompt","conversation","raw log","secret","credential","private key","api key","password","bearer","source code","diff","-----begin","``````")
$lower = $Text.ToLower()
foreach ($m in $forbidden) {
  if ($lower.Contains($m)) {
    Write-Error "Text contains a forbidden marker: $m"
    exit 1
  }
}

$dir = Join-Path $HOME ".agentic-os"
$noteFile = Join-Path $dir "orchestration-notes.jsonl"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# mkdir lock mirrors journal-lock.ts so concurrent writers serialize.
$lockDir = "$noteFile.lock"
$deadline = (Get-Date).AddSeconds(10)
while ($true) {
  try {
    New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop | Out-Null
    break
  } catch {
    if ((Get-Date) -gt $deadline) { Write-Error "note journal lock timeout"; exit 1 }
    Start-Sleep -Milliseconds 100
  }
}
try {
  $note = @{ time = (Get-Date).ToUniversalTime().ToString("o"); field = $Field; text = $Text; writer = $Writer }
  if ($Lane) { $note.lane = $Lane }
  $json = $note | ConvertTo-Json -Compress
  Add-Content -Path $noteFile -Value $json -Encoding utf8
  Write-Output "noted: $Field$(if ($Lane) { " on $Lane" })"
} finally {
  Remove-Item -Path $lockDir -Force -ErrorAction SilentlyContinue
}
