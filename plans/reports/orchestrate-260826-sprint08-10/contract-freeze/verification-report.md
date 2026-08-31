# Sprint 08 contract-freeze verification report

- Package: `news-os.sprint08.contract-freeze`
- Revision: `1.0.0`
- Verified: 2026-08-26
- Recommendation: **HOLD**

## Reproduction

Run from the repository root in PowerShell:

```powershell
Get-Content -Raw qa/fixtures/sprint08/contract-freeze/negative-privacy-fixtures.json | ConvertFrom-Json | Out-Null
Get-FileHash -Algorithm SHA256 plans/reports/orchestrate-260826-sprint08-10/contract-freeze/*.md,qa/fixtures/sprint08/contract-freeze/*
git diff --check
```

The canonical hashes are also written to `hashes.sha256`. Paths use `/` and hashes are lowercase SHA-256. `hashes.sha256` intentionally does not hash itself.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| Fixture syntax | PASS | JSON parsed successfully; 22 cases and 22 named rule classes |
| Forbidden content classes | PASS | Prompt, conversation, user story, code, diff, repository/project identity, path, raw terminal/log, secret, credential, token, capability, personal data, and exact private identifier cases are present |
| Recursive/alias rejection | PASS | Fixture metadata requires recursive normalized detection; nested casing/separator alias case `PF-022` is present |
| Unknown-field rejection | PASS | `PF-017`; DTO policy requires strict allowlists on contribution and snapshot ingress |
| Version field | PASS | Common envelope requires `schemaVersion`; `PF-018` proves the negative definition |
| Idempotency field | PASS | Common envelope requires `idempotencyKey`; replay semantics are reserved; `PF-019` proves the negative definition |
| Provenance fields | PASS | Common envelope requires producer, source record IDs, derivation revision, and observation time; `PF-020` and `PF-021` cover missing/private provenance |
| Estimator/policy revisions | PASS | DTO-specific `estimatorRevision` plus common `policyRevision` are frozen where applicable |
| Uncertainty/sample size | PASS | Forecast, feature, candidate, snapshot, and calibration contracts reserve both where applicable |
| S08-A/B/C ownership | PASS | Case-insensitive, separator-normalized producer patterns are disjoint; shared paths are excluded from every producer set |
| Integration writer | PASS | Exactly one writer owns shared schema/migration registries, DTO exports, generated contracts, route registration, and shared fixture indexes |
| Migration registration | PASS (not performed) | Four non-overlapping ID ranges are reservations only; no product or registry file changed |
| Legacy writer / Phase 21 | PASS (unchanged) | Both are globally forbidden scope in the lane manifest |
| Secret/capability hygiene | PASS | Fixtures contain placeholders only; package scan found no capability or credential value |
| Whitespace validity | PASS | `git diff --check` returned no finding |

## Source artifact hashes before this report

| SHA-256 | Path |
|---|---|
| `10cd6db94e742afeca4b5d85fe37bc90d7b094bad4cf17a0e763b37d0fb313f1` | `plans/reports/orchestrate-260826-sprint08-10/contract-freeze/lane-manifest.md` |
| `c3c9295ee5ffe91eea0109db076b166480b3d8c04b538a8ed634d431d12411b5` | `plans/reports/orchestrate-260826-sprint08-10/contract-freeze/dto-reservation.md` |
| `f723fb4831cbb37dabf04a4db604d6240c954df1aeee639fd09ca95b9617f800` | `plans/reports/orchestrate-260826-sprint08-10/contract-freeze/migration-reservations.md` |
| `6bdb202bcd5e8bc70ecfcc06aa27a1923cf385978751991f07565d63f59ae9e0` | `qa/fixtures/sprint08/contract-freeze/negative-privacy-fixtures.json` |

## Unresolved prerequisites

1. The plan and phase files must be promoted from the coordinator worktree into the lane base revision.
2. An independent gate owner must approve and hash-pin the final package bytes.
3. Live OLC/provider/resource preflight must admit the physical producer writers.
4. Fresh lane-scoped Orca Tasks/Dispatches and isolated worktrees must be created.
5. The controller must name exactly one integration writer and confirm the exact first migration IDs.
6. Each future implementation must supply executable validators for these fixture definitions; this coordination task defines fixtures but does not add product validation code.
7. The disabled legacy writer and blocked Phase 21 state must be rechecked at producer admission.

The freeze artifacts are complete for coordination review, but these prerequisites prevent producer authorization. Recommendation: **HOLD**.

Status: DONE_WITH_CONCERNS
