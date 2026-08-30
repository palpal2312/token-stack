# Sprint 09 Contract v1

Status: DRAFT — requires independent arbiter GO before implementation.

## Scope and authority

Approval: The user approved Contract v1 as written, assigned `palpal2312/admin` as integration owner for shared schema/DTO registration, and authorized the independent contract arbiter. This does not authorize implementation, legacy-writer enablement, or any Phase 21 transition.

S09 accepts only privacy-safe `ForecastFeatureRecord` values or normalized incident/evaluation facts. Community data is an untrusted candidate; it never directly mutates canonical product state or execution authority. Parent Task records remain authoritative; child Attempts are bounded, durable, and auditable.

## Frozen records

- `ContributionCandidate`: `id`, `schemaVersion`, `idempotencyKey`, `consentId`, `actorIdHash`, `workspaceIdHash`, `sourceClass`, `payload`, `payloadSha256`, `provenance`, `createdAt`, `status`.
- `CommunityKnowledgeSnapshot`: `snapshotId`, `schemaVersion`, `snapshotVersion`, `cohort`, `facts`, `sampleSize`, `uncertainty`, `validFrom`, `expiresAt`, `keyId`, `signature`, `rollbackVersion`.
- `WorkflowGraph`: typed nodes/edges, graph hash, max depth 32, max nodes 128, max loop iterations 100, budget and cancellation policy, checkpoint policy, retry/fallback policy, merge queue policy.

Prompts, conversations, user stories, source/diff/repository/path data, raw logs, secrets/tokens, credentials, personal data, and exact private identifiers are forbidden and must be rejected or omitted before persistence.

## API and persistence

All endpoints use `{schemaVersion, requestId, result, error}` envelopes and fail closed with `400 invalid_payload`, `401 unauthenticated`, `403 consent_required`, `409 duplicate_or_conflict`, `413 size_limit`, `422 policy_rejected`, or `503 unavailable`. Community ownership is `go/internal/localdb/community/**` and `community-queue.db`; snapshot verification/import is advisory-only and must be reversible. Shared migrations and DTO barrels remain integration-owner-only.

## Signing and transport

Snapshots are canonical JSON signed with Ed25519. Private signing keys remain outside repository and receipts; verification uses an allowlisted `keyId` and public-key registry. Import requires valid signature, schema/policy version, non-expired timestamp, monotonic snapshot version, provenance, and rollback reference. Invalid, expired, or unknown-key snapshots are rejected without state change.

## Ownership and gates

Community lane owns intake, quarantine, moderation, export/delete, escalation, aggregation, signing, and receipts. Controlled-delivery lane owns graph validation, compilation, checkpoints, cancellation, retry/fallback, and progress. `palpal2312/admin` alone edits shared schema/DTO registration. Acceptance requires consent/quarantine tests, forbidden-field negatives, dedupe/replay tests, signature/expiry/rollback tests, graph-bound tests, crash-resume/merge-safety tests, current-byte manifest, and independent arbiter GO. Legacy writer stays disabled; Phase 21 stays blocked.

## Rollback

Reject/delete/quarantine are reversible state transitions. Snapshot import stores the prior version and can restore it atomically. Graph execution cancellation fences child Attempts and prevents post-cancel writes. Any contract drift or failed gate returns S09 to gated.
