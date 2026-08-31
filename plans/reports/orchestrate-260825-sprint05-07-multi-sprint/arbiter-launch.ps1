$ErrorActionPreference = 'Continue'
$arbiterPrompt = @'
Independent Sprint 05-07 close arbiter. Read the repository plans, authoritative
S05-G1/S06/S07 receipts, and current bytes in the three producer worktrees.
Re-run mechanical Sprint 07 checks, verify receipt hashes and cross-worktree
collisions, and decide GO or NO-GO for closing Sprint 05-07. Phase 21 must stay
blocked. Do not edit product code or producer worktrees. Write only
plans/reports/orchestrate-260825-sprint05-07-multi-sprint/arbiter-go.md or
arbiter-no-go.md, ending with JOB_DONE: S05-07-ARBITER.
'@
$arbiterLog = Join-Path $PSScriptRoot 'arbiter-exec.log'
$codexPath = 'C:\Users\ADMIN\AppData\Roaming\npm\codex.cmd'
$args = @('exec', '--ignore-user-config', '--dangerously-bypass-approvals-and-sandbox', '-')
$arbiterPrompt | & $codexPath @args *> $arbiterLog
exit $LASTEXITCODE
