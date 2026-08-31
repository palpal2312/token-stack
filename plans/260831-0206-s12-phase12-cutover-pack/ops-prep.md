# Phase 12 Cutover — Ops Prep Pack (draft)

Sources of truth (read before executing):
- Gate contract: `plans/260831-0115-s12-phase12-cutover-gate/plan.md`
- Execution runbook: `plans/260831-0206-s12-phase12-cutover-pack/runbook.md`

This pack is a provisioning + operator checklist only. It grants no release, cutover, or budget authority. All state that matters (`legacy_writer`, `phase_21`, controller lease) is per the contract invariants. No credentials or live values appear; env var **names** only.

---

## 1. Provisioning checklist

### 1a. Environment (staging prod-equivalent)
- [ ] Provision a live staging host **distinct from any controlled evidence checkout** (contract entry condition 1). Type: one Windows Server-class VM, 2 vCPU / 4 GB RAM minimum, 40 GB SSD OS+data.
  - `ponytail:` single host — this is a one-node local-first system (SQLite + daemon + Next.js UI); a staging cluster is speculative until the live SLO probes prove it needed.
- [ ] Fresh user + service account (non-admin where possible) for the SEN daemon; no reuse of any evidence-checkout profile.
- [ ] Install prerequisites: Node (project-pinned), Go toolchain (module path fix per runbook preflight), Git for Windows.
- [ ] Clone only the release byte-set from the pinned branch (runbook step 1); `git status --porcelain` must be empty at every step.
- [ ] Env vars to set (names only — values go in the local secret store, never the repo): `AGENTIC_OS_HOME`, `SEN_DAEMON_ADDR`, `SEN_DAEMON_URL`, `SEN_GO_BUILDER_EXEC_AUTHORITY`, `DATABASE_URL`.
- [ ] Verify `scripts/controller-failover.ps1` present and the scheduled-task watchdog installed + enabled (`scripts/install-controller-failover-task.ps1`), matching master `88c1dc3`.
- [ ] Create `%LOCALAPPDATA%\NEWSOS` on the staging host and confirm state/incident JSON writes succeed (probe with a throwaway runId, not the real config).

### 1b. DNS / certs
- [ ] Acquire staging DNS name (e.g. `staging.<domain>`); do **not** point an apex/production record at it.
- [ ] TLS: dev/self-signed acceptable for internal canary; if the live canary must be reachable externally, use a public-free cert (e.g. Let's Encrypt) on the staging FQDN only. No private keys in the repo, CI, or any artifact.
- [ ] Confirm the daemon's `SEN_DAEMON_ADDR` bind is loopback or firewall-scoped; no public port exposure during canary.

### 1c. DB / Postgres resources (per runbook bootstrap — the runbook's preflight + live env imply the durable store)
The runbook bootstrap currently targets **local SQLite** (`sen-product.db` + `community-queue.db`), not managed Postgres. Provision against both so the choice isn't made in the window:
- [ ] Local path: reserve 2× DB dirs (product + community-queue) with known free space; defaults live under `AGENTIC_OS_HOME`. Confirm `DATABASE_URL` resolves **without** credentials in env (file path only) in this layout.
- [ ] If managed Postgres is selected instead (only if a separate DB plan gets owner approval — contract non-goal "DTO/schema migration needs its own plan"): provision the smallest single-zone instance (see §2), one database, one least-privilege app role, TLS enforced. Keep local SQLite as the immediate fallback.
- [ ] Either way: run the migration/checksum ledger check from the S02 evidence methodology (integrity check before any copy; quarantine-on-corrupt) as part of bootstrap verification.

### 1d. Monitoring / metrics (SLO probes)
- [ ] At least one **live, externally verifiable probe** per SLO — no loopback or simulated evidence (contract evidence requirement + runbook invariant).
- [ ] SLO probes to stand up (see runbook step 3 "live canary ... with real SLO/RPO/RTO instrumentation"):
  - Availability: HTTP/daemon health check every 30s, alert on 2 consecutive failures.
  - RPO: age of newest durable write vs wall clock; alert at threshold (start 5 min).
  - RTO: time from failure signal to restored service; alert at threshold (start 15 min).
  - Write-verification: post-atomic-flip probe proving new adapter canonical and legacy inert (runbook step 4).
- [ ] Metrics sink: append-only local log + one dashboard. No third-party ingest required yet; store metric series in `%LOCALAPPDATA%\NEWSOS\s12-metrics\`.
- [ ] Alert thresholds must be **set and armed before the canary starts**, not discovered during it (§3, gate G4).

### 1e. Backup / restore
- [ ] Pre-cutover full backup of `sen-product.db` and `community-queue.db` (or managed-PG snapshot), copied to a second volume/object store.
- [ ] Test restore from that backup on the staging box (offline, using the S2 approach: read-only verify before copy, fail-closed on mismatch). Record a restore receipt with the pinned SHA-256.
- [ ] Backup cadence through the window: nightly + pre-flip + post-flip. Retention: see §2 (start 7 days).
- [ ] Rollback uses the atomic branch (runbook step 5) to restore the prior canonical-write pointer — keep the backup separate from the code rollback so a byte-corruption and a flag-flip are independently recoverable.

### 1f. Access review — who can flip `legacy_writer`
- [ ] Maintain an explicit list (kept out-of-band, not in repo): which named humans/roles can (a) write the controller state JSON under `%LOCALAPPDATA%\NEWSOS`, (b) run `scripts/controller-failover.ps1` / scheduled watchdog, (c) push to the release branch.
- [ ] Rule: **owner-only** may flip `legacy_writer`. No script, CI pipeline, or scheduled task may flip it autonomously — the flip is a manual, supervised, single atomic command (contract invariant: `disabled` stays true until the final step).
- [ ] Separate the arbiter: the independent Phase 12 arbiter (runbook step 8) has **read-only** access to state and bytes and no write path to `legacy_writer`. Confirm no shared credential between operator and arbiter.
- [ ] Disable/remove any earlier broad write grants (e.g., automated failover run-as accounts) on the staging host before the window.

### 1g. No secrets in CI logs
- [ ] Add a redaction scrub step to any CI/scheduled job invoked in the window (and to the local canary runner): strip `SEN_GO_BUILDER_EXEC_AUTHORITY`, `DATABASE_URL`, and any token-like values from logs before they are written or pushed.
- [ ] Env vars are injected at runtime only; no `<env>` blocks with values in workflow files; `echo`/debug printers must not dump environment.
- [ ] Post-run sweep: grep receipts under `plans/reports/s12/` for long-token patterns and `password`/`secret`/`key=` literals before the security/privacy review receipt is written (contract: "no secrets or private content in artifacts").

---

## 2. Budget scaffold (USD/day) — placeholder, owner to replace with provider-quoted figures

Basis: 7-day cutover window on one staging host; local SQLite default, managed PG as an optional line. `ponytail:` these are order-of-magnitude ballparks to size the pack, not a quote — replace with real provider pricing before owner approval (contract entry condition: "New plan + budget approved by the owner").

| Line | Item | Assumption | USD/day (ballpark) |
|---|---|---|---|
| Compute | 1× VM 2 vCPU / 4 GB (reserved) | ~$30/mo equivalent | ~1.00 |
| Storage | 40 GB SSD OS+data | ~$0.10/GB-month | ~0.13 |
| DB (default) | Local SQLite (2 files, no service) | free; bytes go under Storage | 0.00 |
| DB (alt, optional) | Managed PG smallest single-zone | ~$0.15/hr or flat small tier | ~0.35 |
| Egress | Canary + probes + backup upload | low (sub-GB/day) | ~0.05 |
| Monitoring | Local probes + dashboard | self-hosted on VM | 0.00 |
| Backup/restore copy | 2× DB + snapshots to 2nd volume | covered in Storage; keep 7 days | +0.05 |
| Retention | Metric + backup retention **× 7 days** | multiply lines above by 7 for window total | see below |
| Contingency | 20% over the above | re-provisioning / extra drill runs | +0.30 |
| **Total run-rate** | — | — | **~1.9/day** (≈ $13 for 7-day window, ~$16 with contingency) |

Fill columns marked ballpark/placeholder with real numbers; nothing commits spend.

---

## 3. Pre-cutover gates — operator MUST confirm all four before t0

| Gate | Check | Where confirmed / evidence |
|---|---|---|
| G1 Independent pre-gate arbiter READY | Fresh-session arbiter (not the runbook/plan author) returns **READY** for a cutover against promoted bytes — not an S10 grading verdict | Contract entry condition 5; record in `plans/reports/s12/s12-arbiter-readiness.md` |
| G2 Live canary fixtures | Canary fixtures exist and are live-monitored on the staging host (real SLO/RPO/RTO instrumentation), distinct from any controlled evidence checkout | Runbook step 3; `plans/reports/s12/s12-live-canary-receipt.md` |
| G3 Rollback branch armed | Automatic rollback branch marked at snapshot point; a dry rollback drill passes (restore prior canonical pointer) | Runbook steps 2+5; `plans/reports/s12/s12-rollback-drill-receipt.md` |
| G4 Monitoring alert thresholds set | All probe thresholds (§1d) configured, armed, and triggering correctly (fire a test alert, confirm it pages the operator) | Runbook preflight + step 3 |

If **any** gate fails: no cutover. Keep `legacy_writer: disabled` and `phase_21: blocked`, record diagnosed NO_GO (contract Fallback).

---

## 4. Timeline skeleton (t0..tN) with do / done evidence

All times local; each step blocks on the previous. Evidence paths under `plans/reports/s12/` per the runbook artifacts list.

| Step | Do | Done evidence / fail action |
|---|---|---|
| **t0** | Hard preflight: branch must be release worktree, `git status --porcelain` empty, failover script present, `s10-*.test.ts` 33/33, `go build ./... && go vet ./...` green; confirm gates G1–G4 | All preflight lines recorded; **any fail → stop, stay on rollback branch** (runbook preflight) |
| **t1** | Snapshot + pin: freeze master/release byte set; record SHA-256 inventory of legacy canonical write surface; stage host provisioned per §1a–1c | Pinned inventory receipt; `snapshot` dir hash-verified |
| **t2** | Branch for cutover (`260831-*s12-cutover`); **mark automatic rollback branch at this point** (G3) | Branch refs recorded; `plans/reports/s12/s12-rollback-drill-receipt.md` ready |
| **t3** | Start live canary on new adapter with SLO/RPO/RTO instrumentation (G2, G4) | `s12-live-canary-receipt.md` with real measurements; approve promotion only on threshold pass |
| **t4** | **Atomic switch**: flip the single `legacy_writer` flag as the last step (manual, owner-only, per §1f); immediately run write-verification (new adapter canonical, legacy inert) | Write-verification receipt; **any failure → run rollback branch, record NO_GO** (contract invariant) |
| **t5** | Observation cycle: N clean cycles on live env, all probes green (no synthetic/loopback evidence) | Probe series stored in metrics dir; no alert firings beyond test alert |
| **t6** | Retire legacy: remove/inert the disabled legacy writer surface; second write-verification confirming inert | `s12-cutover-receipt.md` + second write-verification receipt |
| **t7** | Evidence chain: cutover + live-canary + rollback-drill + security/privacy receipts, current-byte pinned; no secrets in artifacts (§1g) | All four receipts hash-pinned; security/privacy review receipt |
| **t8** | Independent Phase 12 arbiter (fresh session): GO → `s12-CLOSED_GO-record.md` then controller Finalize; NO_GO → retain, diagnose | `s12-CLOSED_GO-record.md` or diagnosed NO_GO; `plans/handoffs/s12-next-controller-handoff.md` |

Hold until GO is recorded and completed: `legacy_writer: disabled` (flips only at t4, once, reverts on any gate failure), `phase_21: blocked`. Nothing in this pack authorizes t4+.

---

## 5. Adversarial risk register

## Phase 12 cutover risks (operator/attacker/rollback view)

- **Atomic flip blast radius [H]**: the "automatic rollback branch" is a git byte-pin, not a runtime state restore — any writes the new adapter lands between flip and failure survive the checkout, so "rollback" leaves orphaned post-flip data in the canonical store. Mitigation: pre-flip data hash/baseline, and rollback restores the runtime writer pointer first, then quarantines/reconciles writes made after the flip timestamp.
- **Partial-write torn state [H]**: `legacy_writer` flips to `enabled` as the atomic step but "retire legacy surface" is a separate later step, leaving a live window where both writers are nominally active; a crash mid-retire strands a half-removed surface. Mitigation: make retire part of the same transaction or insert an explicit single-writer assert, and have the write-verifier prove only one writer reacts before close.
- **Wrong-direction flip [H]**: the canonical flag is named `legacy_writer` and the contract's post-cutover value is `enabled` — the polarity reads to any operator or future agent as "legacy writer active", so a toggled-in-the-wrong-direction flip re-enables the retired path or disables the new adapter silently. Mitigation: alias/rename the flag to `canonical_writer: <adapter>` or verify the actual polled write-source state (not the config string), with a unit test pinning flip direction.
- **Wrong-env flip [H]**: preflight only checks "not master branch" — nothing proves the worktree IS the live staging env versus a controlled evidence checkout or prod, so the flip can execute against the wrong environment. Mitigation: hard env fingerprint (hostname + lease token + pinned inventory hash) asserted at preflight AND re-asserted immediately before the flag write.
- **Observation blindness [H]**: SLO/RPO/RTO instrumentation is promised at the canary step but no preflight verifies the metrics/monitoring backend is configured and exporting before the flip — dark monitoring means the rollback trigger never fires and gate failures are invisible. Mitigation: preflight asserts a fresh scrape timestamp and a synthetic failing check that actually raises an alert, before any flip.
- **Runtime DTO drift [M]**: the rewrite fixed `go build` but compile success doesn't prove wire compatibility — the new adapter and legacy surface can serialize the same DTO/config with different struct tags, defaults, or field order. Mitigation: add a wire-format golden test comparing the new adapter's emitted bytes to pinned legacy bytes before the flip.
- **Data migration without backup [M]**: "snapshot + pin" pins git bytes only; there is no backup of the data owned by the canonical write surface, yet the retire step removes/inerts the legacy path that may still hold historical rows. Mitigation: full storage-backed snapshot with a restore drill before the flip; retire by `inert` (not delete) until one full retention cycle with a clean observation record.
- **Unauthorized trigger [M]**: anyone with push/PR-merge access can create the `*-s12-cutover` branch and flip; the preflight never verifies the active controller lease the gate lists as an entry condition, and the arbiter is "a fresh session" with no proof of independence. Mitigation: preflight requires a signed lease token + named approver recorded in the receipt, CODEOWNERS locking the flag file, and the arbiter's independence attested by pixel-ident hashes of reviewed bytes.
- **Contract contradiction — flip count [L]**: the gate says the flag "flips only once" AND "goes back on any gate failure" — that's two flips, so operators will disagree whether a re-flip is permitted after NO_GO. Mitigation: define rollback as an explicit restore+NO_GO with a fresh approved run required for a second flip, not a silent auto re-flip.
- **Unquantified retire trigger [L]**: "after N clean observation cycle" leaves N undefined, so premature retirement can shrink the blast-radius envelope before evidence is convincing. Mitigation: pin N in the run (e.g. 24h of measured SLO pass) before the run starts.

JOB_DONE: Phase 12 ops-prep pack drafted (provisioning + budget scaffold + risk register); owner approval and live environment remain required before any cutover.
