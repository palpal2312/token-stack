# Sprint 08 migration reservations

- Reservation revision: `1.0.0`
- State: identifiers reserved; **no migration is registered by this document**
- Registration owner: one controller-designated integration writer
- Migration policy: forward-only, checksummed, transactional where supported, replay-safe

## Reserved identifiers

| Lane | Reserved ID range | Fragment ownership | Registration status |
|---|---|---|---|
| S08-A | `s08a_001`-`s08a_099` | Admission, approval, scheduler, and forecast-presentation persistence only | Unregistered |
| S08-B | `s08b_001`-`s08b_099` | Memory, Context Pack, indexing, quarantine, and safe-ingestion persistence only | Unregistered |
| S08-C | `s08c_001`-`s08c_099` | Run Learning, Forecast Feature, calibration-fact, and local candidate persistence only | Unregistered |
| Integration | `s08i_001`-`s08i_099` | Cross-lane registration/compatibility only; no producer feature tables | Unregistered |

Identifiers are case-insensitive and cannot be reused after a fragment is accepted, rejected, or superseded. A fragment name must be `<id>-<kebab-purpose>` and its receipt must carry SHA-256, lane, schema revision, dependencies, forward action, compensating action, and focused verification command.

## Serialization protocol

1. Producers write only lane-owned fragments using their reservation; they do not edit a shared registry.
2. Each producer stops writing and emits a current-byte SHA-256 receipt.
3. The integration writer verifies ownership, dependency order, checksum, replay/idempotency, and downgrade/compensation notes.
4. Exactly one integration writer registers accepted fragments in deterministic order: explicit dependencies first, then A, B, C, and integration fragments by numeric suffix.
5. The integration receipt records accepted hashes and the resulting registry hash. Any byte drift returns the gate to HOLD.

## Collision and rollback rules

- No lane may create or alter another lane's tables, indexes, triggers, views, or migration IDs.
- Cross-lane foreign keys and shared enum/table changes require an integration fragment and explicit dependency entries.
- Destructive down migrations are prohibited. Rollback uses a forward compensating migration or excludes an unregistered fragment.
- Unsupported application/schema combinations fail closed; compatibility shims must be versioned and integration-owned.
- Existing `go/internal/localdb/product/schema.go`, `go/internal/localdb/community/migrations.go`, `go/migrations/**`, and any shared migration index remain integration-writer-only.

## Unresolved prerequisite

The controller must name the integration writer, verify live capacity, and approve the exact first IDs before any producer uses these reservations. Until then all identifiers are reservations, not authorization to create or register migrations.
