# S02-L1-008 Controller Failover Independent Review

## Decision

**NO-GO**

Authorization and crash-window gaps can produce split-brain or unauthorized lease takeover. Observational stale/busy handling and generation-tagged claim prompts are directionally correct, but must not be treated as production-safe until blockers below are fixed and a sandboxed stale-state drill passes.

## Scope and method

| Item | Detail |
|---|---|
| Reviewer lane | Lane 1 worktree only; sole write: this file |
| Sources | `Documents/Agent OS/source/scripts/controller-failover.ps1`, `.../controller-failover.json`, `.../handoffs/controller-succession-sprint02.md`, `docs/orchestration-runbook.md` §Controller succession |
| Routing | AgentKit `ak:code-review` + `ak:debug` (root-cause before fix advice); threat split per runbook + STRIDE-style authz |
| Mutations | None against failover runtime: no `-Mode Check/Claim/Heartbeat/Release`; no master edits; no task changes |
| Static checks | PSParser `SYNTAX_OK` on PS 5.1.22621; JSON parse OK; path-escape probes; UTF-8 BOM probe; scheduled-task read-only inspect |

### Artifact digests (at review time)

```text
54b105e398ee6aae6a3dfc420cc0023ce7db9c9233adb0f7c11ab0faa33464ff  scripts/controller-failover.ps1
c8189e44c8fbfc441ab7df564b2f560b7dd2ef124ca761b9ccb6dfbbcda27cbc  plans/reports/orchestrate-260825-sprint02-close/controller-failover.json
```

Live lease (read via filesystem, not script): `status=active`, `owner=codex-master`, `generation=1`, `heartbeatSource=orca-output-observer`. Scheduled task `NEWSOS-Controller-Failover`: Ready, PT5M repeat, action `-Mode Check`, `LastTaskResult=0`.

---

## Threat-model matrix

| Threat | Verdict | Notes |
|---|---|---|
| Split brain | **FAIL** | Unauthorized Heartbeat/Claim + send-before-save + post-cooldown second dispatch can yield two agents with CONTROLLER_FAILOVER prompts; generation check limits dual *claim* but not dual pre-claim action. |
| Stale / busy owner | **PASS** | Stale interval + connected/writable + `tui-idle` wait; busy → `AT_RISK` and exit 0 (`controller-failover.ps1` ~180–191). Matches runbook. |
| Observational heartbeat | **PASS** (with caveat) | `lastOutputAt` can refresh lease without LLM (`~163–172`). Caveat: extends lease on any terminal output, not proof of controller intent. |
| Duplicate dispatch | **FAIL** | Send then Save-State; cooldown then next successor for **same generation** (`~194–234`). Violates runbook literal “never dispatch another successor for the same generation.” |
| Claim authorization | **FAIL** | `-Generation` helps; bare `stale` still authorizes arbitrary `-Owner`/`-Terminal`. Heartbeat can rewrite owner without claim. |
| Scheduled-task survival | **FAIL** (ops) | Task exists and is 5‑minute, but `LogonType=Interactive`, `DisallowStartIfOnBatteries=True`, `StopIfGoingOnBatteries=True` — dies on logout/battery. No in-repo task registration for drift control. |
| Terminal replacement | **PASS** (ops burden) | Orphaned handles → null → skip/failover path. Config/lease handles are runtime-scoped; must be refreshed manually (documented in handoff risk). |
| Unavailable providers | **PARTIAL** | Idle/connected filter + `attemptedSuccessors` after cooldown. Exit 2 when none. Partial because retry invites a second controller for the same generation. |
| Path / secret safety | **PARTIAL** | `stateFileName` escape check present; `incidentLogName` not checked. No secrets in config; absolute paths with spaces are quoted in claim string. State written with PS 5.1 UTF-8 **BOM**. |
| PowerShell 5.1 behavior | **PARTIAL** | Syntax OK on 5.1. Risks: `Set-Content -Encoding UTF8` BOM; `[DateTime]::Parse` without invariant/round-trip; `exit` inside `try` still hits `finally` (OK). |

---

## Blockers (must fix)

### B1 — CRITICAL: `Heartbeat` can steal or forge the lease

**Code:** `controller-failover.ps1` 99–113.

**Reproduction (do not run against live lease):**

1. Lease: `owner=codex-master`, `status=active` or even `takeover_dispatched`.
2. Any local process runs:
   `powershell -File controller-failover.ps1 -Mode Heartbeat -Owner evil-standby -Terminal term_attacker`
3. State becomes `owner=evil-standby`, `status=active`, takeover fields cleared, new heartbeat — **no check** that caller is current owner, successor, or holds a generation.

**Minimal fix:** Heartbeat may only refresh when `-Owner`/`-Terminal` equal current `state.owner`/`state.terminal` (or omit those params and never rewrite identity). Refuse Heartbeat when `status` is `takeover_dispatched` unless owner matches. Never accept a foreign owner via Heartbeat; ownership changes only through `Claim`.

### B2 — CRITICAL: `Claim` stale bypass ignores dispatch authorization

**Code:** 128–138.

```powershell
$authorizedDispatch = $state.status -eq 'takeover_dispatched' -and ...
if (-not $authorizedDispatch -and -not $stale) { throw ... }
```

When `stale -eq $true`, **any** `-Owner`/`-Terminal` with matching `-Generation` claims successfully — not limited to `config.successors` or `takeoverOwner`.

**Reproduction:**

1. Force stale heartbeat (or wait `staleAfterSeconds=900`) while `generation=1`.
2. Run Claim as non-successor:
   `-Mode Claim -Owner not-in-config -Terminal term_any -Generation 1`
3. Observe `CLAIMED` and generation bump.

**Minimal fix:** Remove the bare `-not $stale` alternative. Allow Claim only when:

- `status -eq 'takeover_dispatched'`, and
- `-Owner/-Terminal` equal `takeoverOwner`/`takeoverTerminal`, and
- `-Generation -eq state.generation`, and
- owner is in `config.successors` (or equals configured master for explicit reclaim policy).

Optional break-glass: separate `-Mode ForceClaim` gated by an explicit config flag, never the default path.

### B3 — HIGH: Send-before-save crash window → duplicate prompt

**Code:** 227–234 — `terminal send` then `Save-State` with `takeover_dispatched` / `attemptedSuccessors`.

**Reproduction:**

1. Reach takeover path; kill process after successful `terminal send`, before `Save-State`.
2. Next scheduled `-Mode Check`: status still `active`, successor not in `attemptedSuccessors` → **second identical CONTROLLER_FAILOVER prompt**.

**Minimal fix:** Persist `takeover_dispatched` + `attemptedSuccessors` + `takeoverDispatchedAt` **before** send. On send failure, write incident and leave pending (cooldown / retry same successor), do not clear authorization blindly.

### B4 — HIGH: Post-cooldown second successor for the same generation

**Code:** 194–206, 202–234; runbook: “never dispatch another successor for the same generation.”

After `dispatchCooldownSeconds`, a different idle successor not in `attemptedSuccessors` receives a new prompt while `generation` is unchanged. `-Generation` prevents a second *successful Claim* after the first claim bumps generation, but both agents can still act as Lead Orchestrator **before** claiming (handoff says claim first; LLMs may not).

**Minimal fix:** While `generation` unchanged, only re-prompt `takeoverOwner`/`takeoverTerminal` after cooldown (or mark `takeover_failed` and require human/config bump). Do not select the next priority successor until a new generation exists or an explicit abandon increments a `dispatchEpoch` recorded in state.

### B5 — HIGH (ops): Scheduled task will not survive logout / battery

**Evidence:** Task `NEWSOS-Controller-Failover` — `Principal.LogonType=Interactive`, `DisallowStartIfOnBatteries=True`, `StopIfGoingOnBatteries=True`, repetition `PT5M` / `P3650D`. Cadence matches runbook (5 min / 15 min stale); survival does not.

**Minimal fix:** Document hard dependency on interactive session **or** switch to a non-interactive principal with battery allowed for this watchdog. Commit a registration script next to `controller-failover.ps1` so task settings are reviewable.

---

## Non-blocking findings

| ID | Severity | Issue | Minimal fix |
|---|---|---|---|
| N1 | MEDIUM | `Release` has no owner check (116–122) — any caller can mark lease released and suppress failover | Require `-Owner` match `state.owner` (and optional generation) |
| N2 | MEDIUM | `incidentLogName` not escape-checked (46–49 only guards `statePath`) | Same parent-dir check (prefer `GetFullPath` then compare) for incident path |
| N3 | MEDIUM | PS 5.1 `Set-Content -Encoding UTF8` writes BOM (confirmed `EF BB BF` on live lease) | Write UTF-8 no BOM via `Utf8Encoding($false)` / .NET API |
| N4 | LOW | `[DateTime]::Parse($state.heartbeatAt)` culture-sensitive | `Parse(..., InvariantCulture, RoundtripKind)` |
| N5 | LOW | Mutex busy → `exit 0` (56–57) makes skipped runs look successful in Task Scheduler | Exit distinct code (e.g. 3) or log “MUTEX_BUSY” to incident file before exit |
| N6 | INFO | Handoff correctly notes failover dispatch not sandboxed-proven | Keep Phase-style drill blocked until B1–B4 fixed |

---

## What already matches the runbook

- Lease fields: owner, terminal, heartbeat, status, monotonic generation.
- Observational refresh from bound Orca terminal output without an LLM call.
- Stale + idle/disconnected/unavailable required; stale+busy → `AT_RISK`.
- Successors come only from config priority list (not arbitrary worktree terminals).
- Claim prompt embeds `-Generation` matching current lease generation.
- Global mutex + `MultipleInstances=IgnoreNew` reduce concurrent Check overlap.
- `Release` exists so a finished controller can avoid false takeover (authz still missing — N1).

---

## Static verification (non-mutating)

```text
PSParser.ParseFile(controller-failover.ps1) -> SYNTAX_OK (PS 5.1.22621)
ConvertFrom-Json(controller-failover.json) -> OK (3 successors, stale=900, cooldown=600)
Join-Path escape of stateFileName '..\evil.json' -> blocked by existing parent check
Join-Path escape of incidentLogName '..\evil.log' -> NOT blocked by script today
Set-Content -Encoding UTF8 -> BOM EF BB BF
Get-ScheduledTask NEWSOS-Controller-Failover -> Ready, PT5M, -Mode Check only
No -Mode Check/Claim/Heartbeat/Release invoked by this review
```

---

## GO criteria (re-review)

1. B1–B4 fixed in `controller-failover.ps1` with focused tests or a documented sandbox drill that proves: no foreign Heartbeat, no stale arbitrary Claim, no duplicate send on crash, no second successor same generation.
2. B5 accepted in writing (interactive+AC-only) **or** task principal/settings fixed and registered from repo.
3. Sandboxed stale-state drill recorded (handoff currently: “Not run”).
4. Lane1 (or arbiter) re-hash script and attach digests.

Until then: **NO-GO** for relying on this mechanism as the sole controller continuity control.
