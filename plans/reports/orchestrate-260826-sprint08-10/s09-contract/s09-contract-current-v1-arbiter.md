# Sprint 09 Contract v1 — Independent Current-Byte Arbiter Verdict

- Verdict: **GO**
- Arbitrated: 2026-08-28
- Package: `s09-contract-current-v1` (worktree `s09-contract-arbiter-current-v1`)
- Mode: independent, read-only, current-byte. Prior S09 contract receipts and prior arbiter verdicts were not used as evidence.

## Current-byte verification

Recomputed SHA-256 in this worktree before analysis; both match `current-byte-manifest.json` exactly. No drift.

| File | Manifest SHA-256 | Recomputed SHA-256 | Match |
|---|---|---|---|
| `s09-contract.md` | `2750f2f71b14ba03c92ffa151f1dfcc8df01b5efcd4f2ed7b2f977eec830a8ec` | `2750f2f71b14ba03c92ffa151f1dfcc8df01b5efcd4f2ed7b2f977eec830a8ec` | YES |
| `s09-contract.json` | `96d9dadbe711a38f0d161ccf62c88c2bcbb9fc548e2bffe75a3349f74f8d59d6` | `96d9dadbe711a38f0d161ccf62c88c2bcbb9fc548e2bffe75a3349f74f8d59d6` | YES |

Cross-check: the coordinator checkout copies at `C:/Users/ADMIN/Documents/Agent OS/source/plans/reports/orchestrate-260826-sprint08-10/s09-contract/` hash identically — no inter-copy drift.

## Evidence reviewed

- Current contract bytes: `s09-contract.md`, `s09-contract.json` (hashes above).
- Manifest: `current-byte-manifest.json` — `required_verdict: independent_arbiter_go`, `legacy_writer: disabled`, `phase_21: blocked`.
- S08 shared gate: `shared-gate/sprint08-shared-gate-report.md` — freezes single integration writer, forbidden private field classes, disjoint lane ownership, rollback-to-HOLD on drift; Phase 21 blocked; legacy writers disabled.
- S08 contract freeze: `contract-freeze/admission-receipt.md`, `verification-report.md`, `lane-manifest.md`, `dto-reservation.md`, `migration-reservations.md` — frozen envelope (`schemaVersion`, `idempotencyKey`, `provenance`, `redactionClass`, `policyRevision`), recursive forbidden-field rejection, one integration writer, forward-only checksummed migrations, reserved non-overlapping IDs.
- Phase-03 Sprint 09 requirements: `plans/260826-1551-news-os-next-parallel-sprints-08-10/phase-03-sprint-08-parallel-foundation-lanes.md` (file holds the Sprint 09 "community escalation and controlled delivery" requirements): consent/quarantine/provenance, allowlisted Forecast Feature Records and normalized incident/evaluation facts only, signature/schema-version/dedupe validation, signed versioned snapshots with expiry, bounded typed workflow graphs (loops, budgets, checkpoints, cancellation, retry/fallback, merge-queue), parent Task authority with durable auditable child Attempts, legacy writer disabled, no Phase 21, independent arbiter GO.
- Existing types: `go/internal/runlearning/runlearning.go` (Envelope, `ForecastFeatureRecord`, `ContributionCandidate`, `CalibrationError`, recursive `ValidatePrivacy` forbidden-field walker, `SafeError` envelope — all matching the S08 freeze and S09 field sets), `go/internal/localdb/community/schema.go` (quarantine/reject state machine, `QuarantineRef`, `DeliveryAttempt`, `PublicationReceipt`, reversible transitions), `go/internal/localdb/community/migrations.go`, `src/lib/llmops/workflow.ts` (current controlled-delivery seed owned by the controlled-delivery lane), `src/lib/sen/canonical-adapters.ts` (Phase 03 canonical adoption: parent Task authoritative, child Attempt statuses, quarantine import states).
- Legacy-writer control: `src/app/api/sen/chat/route.ts` defaults `SEN_CHAT_LEGACY_WRITER` off (opt-in `=1` only); disabled state confirmed in code.

## Findings

1. **Internal consistency (md ↔ json): PASS.** Graph limits identical (depth 32 / nodes 128 / loop iterations 100). Forbidden-field lists equivalent (md "secrets/tokens" = json `secret` + `token`). Signing identical (Ed25519, external allowlisted registry, no private key in repo). Controls identical (`legacy_writer: disabled`, `phase_21: blocked`, parent-Task execution authority). Gate list maps 1:1 (md joins consent/quarantine into one phrase; json splits into two — same coverage). Records: json adds `NormalizedIncidentFact` to the four records; md names it in scope text ("normalized incident/evaluation facts") but omits it from the "Frozen records" bullet list — asymmetric presentation, not a contradiction.
2. **Privacy: PASS.** `actorIdHash`/`workspaceIdHash` (hashed, never raw), `payloadSha256`, `consentId`, `provenance`; forbidden classes match the S08 freeze policy exactly; rejection/omission required before persistence; `forbidden_field_negative` is an acceptance gate. Existing `runlearning.ValidatePrivacy` already implements recursive normalized rejection.
3. **Ownership: PASS.** Community lane owns `go/internal/localdb/community/**` + `community-queue.db`; controlled-delivery lane owns graph validation/compilation (`src/lib/llmops/workflow.ts` per json); shared schema/DTO registration and shared migrations are reserved to `palpal2312/admin` alone — this carves `community/migrations.go` out of the community path glob and preserves the S08 single-integration-writer rule. Lane split matches phase-03.
4. **Graph bounds: PASS.** Typed nodes/edges, graph hash, max depth 32, max nodes 128, max loop iterations 100, budget/cancellation/checkpoint/retry/fallback/merge-queue policies — satisfies phase-03 bounded-graph requirement; `graph_bounds` and `crash_resume_merge_safety` are acceptance gates.
5. **Signing/expiry/rollback: PASS.** Ed25519 over canonical JSON; allowlisted `keyId` + public-key registry; private keys outside repo and receipts. Import requires valid signature, schema/policy version, non-expired timestamp, monotonic snapshot version, provenance, rollback reference; invalid/expired/unknown-key rejected without state change. Frozen `CommunityKnowledgeSnapshot` carries `validFrom`, `expiresAt`, `keyId`, `signature`, `rollbackVersion` — every enforced field exists in the record. Snapshot import stores prior version and restores atomically; cancellation fences child Attempts.
6. **Acceptance gates: PASS.** Nine required gates (consent, quarantine, forbidden-field negative, dedupe/replay, signature/expiry/rollback, graph bounds, crash-resume/merge-safety, current-byte manifest, independent arbiter GO) cover every phase-03 success criterion, including "legacy writer remains disabled and no Phase 21 command" and "arbiter GO with no unresolved provenance or merge-safety findings".
7. **Integration owner: PASS.** Both md and json record the user-approved owner `palpal2312/admin` for shared schema/DTO registration, consistent with the coordinator's task statement and the S08 single-integration-writer freeze. The contract's approval clause is self-limiting: no implementation, no legacy-writer enablement, no Phase 21 transition authorized.
8. **Controls: PASS.** `legacy_writer: disabled` and `phase_21: blocked` in manifest, both contract files, and confirmed in current code default.

## Observations (non-blocking)

- md "Frozen records" omits `NormalizedIncidentFact` though json lists it and md scope text references it; implementers should treat the json record list as exhaustive.
- The contract relies on the S08 frozen policy for strict unknown-field rejection on ingress; md says forbidden fields "must be rejected or omitted" without restating the unknown-field rule. The `forbidden_field_negative` gate plus the S08 freeze dependency keep this enforced.
- Existing `community/schema.go` `SanitizedContribution.RawPayload` is a Sprint 08 local-quarantine artifact; S09 frozen `ContributionCandidate` forbids raw content — implementers must not promote RawPayload into S09 records.

## Decision

**GO** for the hash-pinned current Sprint 09 Contract v1 package exactly as hashed above. This GO authorizes contract acceptance only; it does not enable the legacy writer, unblock Phase 21, or dispatch implementation. Any byte drift in either file invalidates this verdict and returns S09 to gated.

Status: DONE

JOB_DONE: S09-CONTRACT-ARBITER-CURRENT-V1
