# NEWOS-MASTER Forward Test (PI, read-only)

- Target skill: `.claude/skills/newos-master/SKILL.md` (+ bundled `scripts/newos-master.ps1`, delegated `scripts/controller-failover.ps1`).
- Execution contract honored: read the skill completely; used ONLY `-Mode Locate` and `-Mode Status` (read-only). No `Check`, `Claim`, `Heartbeat`, `Release`, no prompt sends, no runtime-state edits.
- Expected lease state per prompt: healthy. Confirmed: status `active`, owner `codex-master`, generation 1.

## Verdict

```
VERDICT: GO
```

## 1. Locates latest config, handoff, memory, runbook — PASS

`powershell .claude/skills/newos-master/scripts/newos-master.ps1 -Mode Locate` → exit 0:

| Artifact | Located | Exists |
|---|---|---|
| runId | `orchestrate-260825-sprint02-close` | ✔ (latest non-released orchestrate-* config) |
| configPath | `plans/reports/orchestrate-260825-sprint02-close/controller-failover.json` | ✔ |
| handoffPath | `plans/handoffs/controller-succession-sprint02.md` | ✔ (5,866 B, full continuation contract) |
| memoryPath | `docs/newsos-master-memory.md` | ✔ |
| runbookPath | `docs/orchestration-runbook.md` | ✔ |

Resolution logic: newest `LastWriteTimeUtc` `orchestrate-*/controller-failover.json` whose `Status` ≠ `released`; if none non-released, newest overall; throws (never guesses) when zero configs exist. Safe-fail. `docs/*` and the handoff were read completely per skill Step 2; both content-generate the located paths.

## 2. Refuses to steal a healthy lease — PASS

- Lease is healthy: `Status` shows `active`, `owner=codex-master`, `generation=1`, `heartbeatAt=2026-08-25T08:51:28Z` (≈1–2 min before run, inside `staleAfterSeconds=900`), `takeoverOwner/TakeoverTerminal=null`, `attemptedSuccessors=[]`. Source of heartbeat: `orca-output-observer` (token-free local detector, by design).
- No mutation: lease state file `%LOCALAPPDATA%\NEWSOS\controller-succession-orchestrate-260825-sprint02-close.json` hash byte-identical before/after both commands (SHA-256 `18487057…9ef76d`, 488 B, mtime unchanged). Only no-op side effects in the code path (existing-stateDir existence check; mutex acquire/release).
- Structural refusal, three independent layers:
  1. Dispatch path requires heartbeat stale ≥900 s AND owner terminal idle/disconnected — a fresh per-run `-Mode Status` never reaches it.
  2. `Claim` is valid only for the exact `takeoverOwner`/`takeoverTerminal` of a `takeover_dispatched` state AND an allowlisted successor; wrong per-generation values throw. Check mode can write the heartbeat-observer refresh; it was not invoked per mandate.
  3. Wrapper `Locate`/`Status` exit before any Orca terminal mutation; the skill text instructs "active with a healthy owner: do not steal the lease. Report who owns it and continue only as a read-only observer."

## 3. Safe exact next action — PASS

- Both commands return lease truth; SKILL Step 3 routes by that truth: healthy active → report owner, continue read-only; `released` → report latest completed checkpoint, never auto-revive a closed sprint; stale `active` → `-Mode Check` (token-free watchdog picks an allowlisted standby; controller does not self-select); `takeover_dispatched` → execute only the exact claim command from the prompt naming this owner/terminal/generation.
- Handoff `plans/handoffs/controller-succession-sprint02.md` provides an exact-action sequence with a first safe step: run `controller-failover.ps1 -Mode Status`, verify owner/generation/heartbeat/standby bindings; then reconcile receipts, update plans from evidence, mark jobs complete, and release only via the lease wrapper when Sprint 02 work is exhausted. Guardrails explicit: coordination-only, no coding, no Phase 21 cutover, no commits on the intentionally dirty master, no duplicate writer, zero redactions.
- The still-`active` lease with Sprint 02 closed is the documented handoff Remaining item (succession-mechanism reconciliation + release pending); the skill correctly reports it without auto-releasing or auto-stealing.

## 4. Continuous evidence-backed memory update protocol — PASS

Two consistent layers:
- Skill "Durable memory": consume `docs/newsos-master-memory.md` at takeover; update continuously only when an incident/test/gate/explicit user decision proves a reusable lesson; merge duplicates; link evidence; on conflict preserve current verified contract + user decision and mark older guidance superseded rather than silently reversing; keep volatile handles/timestamps/session counters in run state (not memory); never store secrets, raw prompts, transcripts, personal data, or private project content; sprint-close sequence = retrospective → memory checkpoint & behavior-changing lessons → plan/HANDOFF/backlog from accepted evidence → release lease.
- `docs/newsos-master-memory.md` "Memory update protocol": read-before-add, merge duplicates, add only evidence-supported lessons, conflict → preserve + supersede with reference, volatile data out of the file, credential-free. Backed by a Current checkpoint (Sprint 02 CLOSED — GO + canonical arbiter evidence link, Sprint 03 next, Phase 21 blocked) and 10 verified operating lessons (OM-01..OM-10), each with a durable-action and evidence column.
- Cross-consistency: controller takeover policy in memory mirrors the contract in `docs/orchestration-runbook.md` ("Controller succession") and the hardened lease script (AT_RISK vs abandoned, one successor per generation, cooldown, coordination-only scope inheritance).

## 5. Caveats recorded (non-blocking)

- `Locate`/`Status` are implemented as pure state reads; the only write-capable side effect in the chain (`orca-output-observer` heartbeat refresh) lives in `-Mode Check`, which this forward-test did not invoke — so no live-observer write was exercised here.
- Wrapper validates the absolute `orcaExe` path before Status; requires `orca.exe` present (verified) or `orca` on PATH. On Windows logout Orca terminals die → Scheduled Task cannot take over until next interactive login; handoff+lease preserve resumability (documented limitation, not defect).
- If ALL orchestrate configs are `released`, Locate returns the newest overall rather than a `null` lease — mild ambiguity; the script still fails safe (no dispatch) and the skill routes released-state behavior by the returned status.

## Artifacts

This report only. Skill, scripts, runtime state, configs, handoff, memory, runbook: unmodified.

JOB_DONE: NEWOS-MASTER-FORWARD-TEST