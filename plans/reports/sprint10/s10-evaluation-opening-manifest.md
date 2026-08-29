# Sprint 10 evaluation opening manifest

## Authority and status

This is an **advisory-only** S10 evaluation-opening manifest. It creates no
worker-launch authority, Orca task/dispatch authority, lease authority, or
GO/NO-GO authority. The legacy writer remains **disabled**, Phase 21 remains
**blocked**, and this manifest authorizes **no cutover**.

## Exact inputs

| Input | Frozen reference | Role |
|---|---|---|
| Opening source | `7f2cc63de4bf261c0c3bca96add94d64115ab90c` | S09 `CLOSED_GO` master baseline. |
| S09 close record | `plans/reports/sprint09/s09-close-gate-record.md` at `7f2cc63` | Confirms S09 closure and that S10 may open without execution. |
| S09 final arbiter | `b9780ad` / `plans/reports/sprint09/s09-final-independent-arbiter-final-verdict.md` | Independent GO for S09 CloseGate only; explicitly excludes S10 and Phase 21. |
| S09 current-byte pins | `675a1b4` / `plans/reports/sprint09/s09-i13-current-byte-repin.json` | Nine SHA-256 pins and GET-only controls. |
| S09 correction | `e0233d3` | Removal of the legacy orchestration ping writer. |
| S08 frozen evidence | `plans/reports/orchestrate-260826-sprint08-10/shared-gate/sprint08-shared-gate-report.md` | Frozen ownership, privacy, rollback, OLC, and advisory-learning constraints. The authoritative-copy path is absent from this checkout; this reference was read from the retained S08 evidence worktree only. |
| S10 plan phases 04 and 05 | `plans/260826-1551-news-os-next-parallel-sprints-08-10/phase-04-*` and `phase-05-*` | Required replay inputs. They are absent from this non-coordinator checkout and must be supplied/hash-pinned before any S10 execution or verdict. No replacement is created here. |

## Scope and non-goals

S10 may define and evaluate an offline, replayable advisory scorecard for
elapsed/sequential error, coverage, utilization, retry/rework misses,
acceptance calibration, and allocation regret. It may only consume redacted,
frozen inputs and emit redacted evaluation artifacts.

Out of scope: worker launch; live dispatch, allocation, persistence, endpoint
or UI mutation; contract/DTO/migration change; legacy-writer enablement;
release, promotion, cutover, or Phase 21 work. Historical S08/S09 evidence is
input, not an authorization to reopen its producer lanes or alter its records.

## Scorecard acceptance metrics

All metrics are computed over the same redacted replay cohort, with cohort,
clock, denominator, missing-data policy, and estimator revision recorded.
Until Phase 04/05 inputs set approved thresholds, each metric is reported as
`measured`, `not-measurable`, or `insufficient-sample`; none can produce GO.

| Metric | Measurement | Acceptance condition for this opening |
|---|---|---|
| Elapsed error | Absolute and signed difference between predicted and observed end-to-end elapsed duration. | Reproducible from frozen timestamps; no hidden clock or live event input. |
| Sequential error | Difference between predicted and observed critical-path/sequential duration. | Dependency order and missing-edge treatment are declared. |
| Coverage | Eligible replay records with all fields needed for each metric divided by eligible records. | Eligibility and exclusions are redacted and counted. |
| Utilization | Busy or assigned capacity divided by available capacity over the replay window. | Capacity source is pinned; unavailable capacity is not imputed. |
| Retry/rework miss | Observed retry or rework not predicted or classified by the evaluator, plus its false-positive companion. | Attempt identity is pseudonymous; retries are deduplicated by pinned rule. |
| Acceptance calibration | Agreement between predicted acceptance probability/band and observed independent acceptance outcome. | Independent outcome source, bins, and sample-size bounds are stated. |
| Allocation regret | Observed replay outcome of chosen allocation minus the best eligible counterfactual under the same frozen constraints. | Counterfactual set and tie policy are fixed; unavailable outcomes yield `not-measurable`. |

## Ownership and path boundaries

This task owns only `plans/reports/sprint10/s10-evaluation-opening-manifest.md`.
Any future S10 evaluator may write only newly assigned S10 report/fixture paths
and must not modify product, configuration, master handoff, plan files,
S08/S09 receipts, shared schemas, migrations, DTO barrels, release controls, or
worker/dispatch controls. Collision-prone shared surfaces remain integration
owner-only, as frozen by the S08 shared-gate evidence.

## Frozen baseline and replay inputs

The immutable baseline is the tracked tree at `7f2cc63`, including the nine
S09-I13 pinned paths and the GET-only orchestration state surface. Replay input
must be a redacted snapshot with a content hash, cohort identifier, schema and
policy revisions, timestamp normalization, and provenance. It must exclude
prompts, conversation content, source/diffs, repository or filesystem identity,
raw logs, credentials/capabilities, personal data, and exact private IDs.

No live database, live queue, live telemetry stream, mutable run manifest, or
unredacted export is an S10 replay input. Missing Phase 04/05 plan files are a
hard input failure, not a reason to use nearby historical reports as a proxy.

## Gates and checks

| Gate | Required result | Failure action |
|---|---|---|
| Shadow | Evaluator observes frozen inputs only and cannot call dispatch, allocation, writers, or networked control surfaces. | Stop; retain no derived authority. |
| No-op | Empty or unavailable cohort changes no state and emits only a redacted `not-measurable` result. | Stop/reclassify as no-op. |
| Canary | One bounded, redacted, hash-pinned cohort with independent recomputation before any broader replay. | Roll back to the frozen baseline. |
| Rollback | Delete/discard uncommitted derived artifacts; preserve the immutable input hashes and incident note. | No retry with changed inputs unless a new manifest is approved. |
| Security | Verify redaction, forbidden-field rejection, least-privilege read access, no secrets in artifacts, and no network/command side effects. | Quarantine artifact and fail closed. |
| Recovery | Verify replay can restart from input hashes; verify partial output is distinguishable from complete output; verify no duplicate metric publication. | Fail closed and retain only redacted recovery metadata. |

## First bounded executable task

After the missing S10 Phase 04/05 documents are supplied and hash-pinned, run
one local, read-only canary that validates a single redacted fixture against the
seven metric definitions and writes a redacted receipt. It must use no worker,
dispatch, or persistence capability and must preserve the `7f2cc63` baseline.

Fallback: if either plan phase, the redacted fixture, independent acceptance
outcome, or required provenance cannot be pinned, perform only the no-op input
inventory and mark every affected metric `not-measurable`; do not launch work,
retry with substituted evidence, or request a cutover.

Status: DONE
