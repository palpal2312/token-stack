# Sprint 08 DTO reservation

- Namespace: `news-os.sprint08`
- Contract revision: `1.0.0`
- Serialization: canonical UTF-8 JSON; object keys sorted for hashing; timestamps RFC 3339 UTC
- Compatibility: additive optional fields require a minor revision; required-field, meaning, enum, or privacy-policy changes require a major revision

## Common envelope

Every frozen DTO carries:

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | string | Required; exactly `1.0.0` for this freeze |
| `recordId` | string | Required opaque local identifier; never derived from private content |
| `idempotencyKey` | string | Required; deterministic over approved content-free inputs and contract revision |
| `createdAt` | RFC 3339 string | Required UTC provenance time |
| `provenance` | object | Required; contains `producer`, `sourceRecordIds`, `derivationRevision`, and `observedAt` |
| `redactionClass` | enum | Required; `content-free`, `aggregate-only`, or `signed-public` |
| `policyRevision` | string | Required privacy/selection policy revision |

`provenance.sourceRecordIds` contains opaque local record IDs only. It must not contain repository, project, filesystem, user, conversation, terminal, credential, capability, or provider-account identifiers.

## Reserved DTOs

### `RunLearningRecord`

Owner: S08-C internally; public export reserved to the integration writer.

Required domain fields: `runId`, `terminalState`, `startedAt`, `finishedAt`, `activeDurationMs`, `blockedDurationMs`, `retryCount`, `reworkCount`, `reviewOutcome`, `estimateRevision`, `actualRevision`. One immutable record exists per terminal Run; replay returns the original record by `idempotencyKey`.

### `ForecastFeatureRecord`

Owner: S08-C internally; public export reserved to the integration writer.

Required domain fields: `runLearningRecordId`, `featureSetVersion`, `taskCohort`, `configurationCohort`, `sequentialWorkBucket`, `criticalPathBucket`, `usefulLaneRange`, `reviewRetryAllowanceBucket`, `resourceClass`, `costBucket`, `sampleSize`, `uncertainty`, `distributionStatus`, `estimatorRevision`. Derivation is deterministic and content-free.

### `ContributionCandidate`

Owner: S08-C local derivation only; shared export reserved to the integration writer. Sprint 08 does not upload it.

Required domain fields: `forecastFeatureRecordId`, `candidateVersion`, `consentState`, `allowlistRevision`, `cohort`, `metrics`, `sampleSize`, `uncertainty`, `timeWindow`, `selectionBiasLimit`, `estimatorRevision`. `consentState` must not be `approved-for-upload` in Sprint 08.

### `CommunityKnowledgeSnapshot`

Owner: reserved for the later community gateway; Sprint 08 may define fixtures only.

Required domain fields: `snapshotVersion`, `aggregationRevision`, `signatureAlgorithm`, `signature`, `signerKeyId`, `issuedAt`, `expiresAt`, `cohorts`, `sampleSize`, `uncertainty`, `timeWindow`, `selectionBiasLimits`. Import must fail closed on invalid signature, unsupported version, expiry, or forbidden fields.

### `ForecastResult`

Owner: S08-A presentation; estimator input from approved local contracts.

Required domain fields: `forecastVersion`, `estimatorRevision`, `policyRevision`, `sequentialWork`, `criticalPath`, `usefulLaneRange`, `elapsedTimeInterval`, `reviewRetryAllowance`, `resourceAssumptions`, `costRange`, `confidence`, `distributionStatus`, `sampleSize`, `uncertainty`. It must never imply linear speedup.

### `CalibrationError`

Owner: S08-C fact production; later calibration consumers remain out of Sprint 08 scope.

Required domain fields: `calibrationVersion`, `forecastResultId`, `runLearningRecordId`, `estimatorRevision`, `policyRevision`, `elapsedTimeError`, `sequentialWorkError`, `intervalCovered`, `laneUtilizationError`, `retryReworkMissRate`, `acceptanceCalibration`, `allocationRegret`, `sampleSize`, `uncertainty`.

## Forbidden-field policy

Contribution and community-snapshot schemas use a strict allowlist and reject recursively at any object depth, array element, alias, casing, or separator variant:

1. prompt/instruction content;
2. conversation, message, transcript, or user-story content;
3. source code, patch, or diff content;
4. repository or project identity, including remote URL, branch, commit, slug, or workspace identity;
5. filesystem paths or filenames that reveal private structure;
6. raw terminal, console, trace, exception, or log output;
7. secrets, API keys, passwords, private keys, session material, or auth headers;
8. credentials, tokens, cookies, provider-account identifiers, Orca capability material, or dispatch capabilities;
9. personal data and exact private identifiers, including names, email, phone, address, IP/device identifiers, user IDs, conversation IDs, terminal IDs, and task/dispatch IDs.

Unknown fields are rejected, not ignored, on contribution and snapshot ingress. Redaction before validation is insufficient: the original payload shape must be rejected and an audit-safe error may report only the rule class and JSON pointer, never the rejected value.

## Error envelope

Errors use `{ schemaVersion, errorCode, ruleClass, fieldPointer, retryable, policyRevision, correlationId }`. `errorCode` is stable (`CONTRACT_VERSION_UNSUPPORTED`, `FORBIDDEN_FIELD`, `IDEMPOTENCY_CONFLICT`, `PROVENANCE_INVALID`, `SIGNATURE_INVALID`, `OUT_OF_DISTRIBUTION`); `correlationId` is opaque and unrelated to private identifiers.
