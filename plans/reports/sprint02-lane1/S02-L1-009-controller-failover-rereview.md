# S02-L1-009 Controller Failover Re-Review (Post B1–B5)

## Decision

**GO**

Remaining blocker codes: **none** (B1, B2, B3, B4, B5 all cleared).

Prior S02-L1-008 NO-GO is superseded for the failover mechanism. Residuals below are non-blocking under the documented interactive single-user trust model.

## Scope and method

| Item | Detail |
|---|---|
| Prior report | `plans/reports/sprint02-lane1/S02-L1-008-controller-failover-review.md` |
| Routing | AgentKit `ak:code-review` + `ak:security` (STRIDE authz on lease modes) |
| Sources | master `scripts/controller-failover.ps1`, `install-controller-failover-task.ps1`, `test-controller-failover.ps1`, `controller-failover.json`, handoff, runbook §Controller succession |
| Lane 1 write | this file only |
| Live safety | Isolated drill uses synthetic `runId` / `controller-failover-drill-*` state names; live lease/incident hashes unchanged |

### Digests (review time)

```text
093026ce01afaeb27c62ab88faae544d5e25b67766db97f2a1a0c204336e0673  controller-failover.ps1
788a509395bf5624756c60fe2a6a0986a4bc5509383763961dd30e46d8acb881  install-controller-failover-task.ps1
b7c5418f3b8d67499df96f1aef0ce25e30c33f8a6565695928972ddc044fb1bc  test-controller-failover.ps1
67239b3e46321884915b17d47eab777f3f805fecdaa1100ecf1d4ec9768b3968  controller-failover.json
```

Live lease SHA-256 before and after drill: `bce21f4ac0fbd8a109501ff0f68eeb584ff443e792ffd3bf75c6a8909f28381e` (unchanged). Live incident log: absent both times. No `CONTROLLER_FAILOVER` / `-Mode Check` against production config by this review.

---

## B1–B5 clearance

| Code | L1-008 issue | Remediation evidence | Status |
|---|---|---|---|
| **B1** | Heartbeat could rewrite owner/terminal | Heartbeat refuses non-`active`; refuses mismatched `-Owner`/`-Terminal`; never mutates identity — only `heartbeatAt` / `heartbeatSource` (`controller-failover.ps1` 123–137). Drill: `foreign-heartbeat-refused`. | **CLEARED** |
| **B2** | Stale Claim allowed arbitrary owner | Claim requires `takeover_dispatched` + takeover Owner/Terminal match **and** config.successors allowlist; no stale bypass (158–169). Drill: `stale-arbitrary-claim-refused`, `stale-generation-claim-refused`, `authorized-claim`. | **CLEARED** |
| **B3** | Send before Save-State | Persist `takeover_dispatched` + attempted list, then send; send failure incidents and exits 2 leaving pending (286–301). Drill: `persist-before-send-order`. | **CLEARED** |
| **B4** | Same-generation second successor | After cooldown, busy pending stays `TAKEOVER_PENDING`; idle/unavailable pending → `TAKEOVER_ABANDONED` bumps **generation** and clears takeover before next selection (225–259). Drill: `new-generation-before-next-successor`. Matches runbook. | **CLEARED** |
| **B5** | Battery kill + no install script + Interactive undocumented | `install-controller-failover-task.ps1` sets `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`, documents Interactive/Orca desktop limit. Config `requiresInteractiveSession: true`. Runbook states logout/Orca-closed → resume on next login, not fake live standby. Live task: batteries allowed, `LogonType=Interactive`, `LastTaskResult=0`. Drill: `scheduled-task-battery-policy`. | **CLEARED** |

---

## Checklist verification

| Requirement | Result | Evidence |
|---|---|---|
| Current-owner-only Heartbeat/Release | **PASS** | Foreign Heartbeat/Release refused; Release requires `-Owner` + `-Generation` (140–152). Heartbeat cannot change owner. |
| Dispatched allowlisted Claim + generation | **PASS** | Both predicates required; generation must match (162–169). |
| Persist-before-send | **PASS** | Comment + Save-State before `terminal send` (286–296). |
| Failed standby advances generation before different successor | **PASS** | `TAKEOVER_ABANDONED` then `$successor = $null` selection (251–263). |
| No duplicate same-generation dispatch | **PASS** | Cooldown hold; abandon bumps generation before next dispatch. |
| Both state artifacts path-contained | **PASS** | `Resolve-StateChild` leaf-name + fullpath parent check for state and incident (45–57). Probes: `..\evil.json` / nested paths blocked. |
| UTF-8 no BOM | **PASS** | `UTF8Encoding($false)` on Save-State / Write-Incident; live lease bytes start `7B 0D 0A` (`{`), not `EF BB BF`. |
| Invariant timestamp parse | **PASS** | `Parse(..., InvariantCulture, RoundtripKind)` (155, 226). |
| Battery policy | **PASS** | Task `DisallowStartIfOnBatteries=False`, `StopIfGoingOnBatteries=False`. |
| Explicit interactive-session limitation | **PASS** | Config flag, install comments, runbook paragraph on Interactive + battery + logout limits. |
| Scheduled task result | **PASS** | `NEWSOS-Controller-Failover` Ready; `LastTaskResult=0`; PT5M Check action on production config path. |
| Isolated drill (no live takeover) | **PASS** | `test-controller-failover.ps1` → `DRILL: GO (11/11)`, exit 0; live lease/incident unchanged. |

### Independent drill output (this review)

```text
owner-heartbeat                        True
foreign-heartbeat-refused              True
stale-arbitrary-claim-refused          True
stale-generation-claim-refused         True
authorized-claim                       True
claim-bumps-generation                 True
foreign-release-refused                True
authorized-release                     True
persist-before-send-order              True
new-generation-before-next-successor   True
scheduled-task-battery-policy          True
DRILL: GO (11/11)
LIVE_LEASE_UNCHANGED=True
```

Static: PSParser `SYNTAX_OK` on all three scripts (PS 5.1).

---

## Non-blocking residuals (not blocker codes)

| ID | Note |
|---|---|
| R1 | Omitting `-Owner`/`-Terminal` on Heartbeat still refreshes the current lease (identity unchanged). Acceptable under same interactive user who runs the task; tighter binding would require mandatory owner+terminal on every Heartbeat. |
| R2 | Claim allowlist compares config `successors[].terminal` to `-Terminal`; dispatch stores Orca `term.handle`. Fail-closed if those strings ever diverge — keep config handles refreshed (runbook already requires this). |
| R3 | Handoff still says sandboxed drill “Not run”; mechanism evidence now exists via `test-controller-failover.ps1` + this report. Docs refresh is editorial, not a failover NO-GO. |

---

## Threat-model delta vs L1-008

| Threat | L1-008 | L1-009 |
|---|---|---|
| Split brain / unauthorized claim | FAIL | **PASS** (dispatch+allowlist+generation; abandon before next successor) |
| Duplicate dispatch | FAIL | **PASS** (persist-first; same-generation redispatch prevented) |
| Claim / Heartbeat authz | FAIL | **PASS** (with R1 residual) |
| Scheduled-task survival | FAIL (battery + undocumented Interactive) | **PASS** (battery on; Interactive explicit; logout limit accepted) |
| Path / BOM / PS 5.1 parse | PARTIAL | **PASS** |

---

## GO criteria met

1. B1–B5 fixed in master scripts with install + isolated test harness.
2. Independent drill GO without mutating production lease.
3. Task battery policy and Interactive limitation documented and observed live.
4. No remaining blocker codes.
