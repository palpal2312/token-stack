# NEWOS-MASTER Released-Lease Regression (PI, read-only)

- Target: `.claude/skills/newos-master/scripts/newos-master.ps1` one-line fix (`@($candidates)[0]`).
- Executed: ONLY `-Mode Locate` and `-Mode Status`. No `Check`/`Claim`/`Heartbeat`/`Release`, no prompt sends, no lease mutation.
- Repo now has exactly one controller config and the lease is `released`.

## Verdict

```
VERDICT: GO
```

## 1. Wrapper selects the full newest config path (not the first character) — PASS

`-Mode Locate` (exit 0) returned:

```json
"configPath": "C:\\Users\\ADMIN\\Documents\\Agent OS\\source\\plans\\reports\\orchestrate-260825-sprint02-close\\controller-failover.json"
```

The single existing config is `released`, so resolution skipped the non-released scan and landed on the fallback branch. Pre-fix that branch was `Resolve-Path -LiteralPath $candidates[0]` — with one pipeline-produced string candidate, `$candidates` is a scalar and `[0]` indexed its **first character**, throwing. Post-fix `@($candidates)[0]` forces array context and returns the full path. `git diff` (repo not yet committed; compared against the version read earlier this session) confirms the change is exactly that one-line array-wrap. Locate's returned `configPath` also matches the on-disk file byte-for-byte.

## 2. Returns status released — PASS

Both commands report the released lease truthfully (exit 0 each):

```json
"status": "released",
"owner": "codex-master",
"generation": 1,
"heartbeatAt": "2026-08-25T09:01:13.1458879Z",
"heartbeatSource": "controller-release"
```

`takeoverOwner`/`takeoverTerminal` null, `attemptedSuccessors=[]` — no takeover machinery engaged. Locate's `status` and `Status` output agree.

## 3. Skill correctly says do not revive a closed sprint — PASS

`SKILL.md` Start → Interpret the lease:

> `released`: there is no live controller to replace; report the latest completed checkpoint and do not revive a closed sprint automatically.

Machine behavior matches the instruction: on a `released` lease, Locate/Status only report status, owner, generation, heartbeat and point at the handoff checkpoint (`plans/handoffs/controller-succession-sprint02.md`) — no dispatch, no claim, no automatic revival attempt. The controller script's `released` early-exit writes nothing and exits 0.

## 4. No mutation of lease state — PASS

Lease state file `%LOCALAPPDATA%\NEWSOS\controller-succession-orchestrate-260825-sprint02-close.json`
SHA-256 **before** = `fe1092fa…d8e6`; **after** = `fe1092fa…d8e6`. Byte-identical. `heartbeatAt` stayed at the release timestamp (the commands did not rename, write, or move state). Only no-op effects observed: existing-state-dir check and mutex acquire/release.

## Caveats (non-blocking)

- With all configs `released`, Locate still returns the newest config path rather than a `null`-lease marker — acceptable because the skill then routes by the returned `status: released` (report checkpoint, no revival). Noted in the prior forward-test.
- The multi-candidate released-fallback path (all N released) now also resolves correctly due to the same array-wrap fix; not separately exercised (only one config exists).

## Artifacts

This report only. Script, lease state, config, handoff, memory, runbook unmodified.

JOB_DONE: NEWOS-MASTER-RELEASED-REGRESSION