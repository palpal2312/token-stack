# S02-L2-003 Receipt: AO-15 Schema Reconciliation & Lifecycle Store

## Summary
Reconciled `community-queue.db` schema to the exact frozen AO-15 contract table specifications. Implemented full lifecycle tracking for at-least-once delivery attempts, immutable publication receipts, removal reports, and tombstoning.

## Exact DDL / Contract Tables
1. `schema_migrations`
   - `version` INTEGER PRIMARY KEY
   - `name` TEXT NOT NULL
   - `checksum` TEXT NOT NULL
   - `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

2. `community_queue_meta`
   - `key` TEXT PRIMARY KEY
   - `value` TEXT NOT NULL

3. `sanitized_contributions`
   - `id` TEXT PRIMARY KEY
   - `seq` INTEGER NOT NULL UNIQUE
   - `title` TEXT NOT NULL
   - `author_ref` TEXT NOT NULL
   - `plugin_slug` TEXT NOT NULL
   - `version` TEXT NOT NULL
   - `state` TEXT NOT NULL (`draft`, `queued`, `sanitizing`, `approved`, `exporting`, `exported`, `delivered`, `tombstoned`, `quarantined`)
   - `metadata_json` TEXT NOT NULL DEFAULT '{}'
   - `quarantine_reason` TEXT
   - `quarantine_code` TEXT
   - `quarantined_at` DATETIME
   - `created_at` DATETIME NOT NULL
   - `updated_at` DATETIME NOT NULL
   - Indexes: `state`, `seq`, `plugin_slug`

4. `delivery_attempts`
   - `id` TEXT PRIMARY KEY
   - `contribution_id` TEXT NOT NULL (FK -> `sanitized_contributions.id` ON DELETE CASCADE)
   - `attempt_number` INTEGER NOT NULL
   - `target_endpoint` TEXT NOT NULL
   - `status` TEXT NOT NULL
   - `error_message` TEXT
   - `attempted_at` DATETIME NOT NULL
   - Unique Constraint: `(contribution_id, attempt_number)`

5. `publication_receipts`
   - `id` TEXT PRIMARY KEY
   - `contribution_id` TEXT NOT NULL UNIQUE (FK -> `sanitized_contributions.id` ON DELETE CASCADE)
   - `delivery_id` TEXT NOT NULL UNIQUE (FK -> `delivery_attempts.id` ON DELETE CASCADE)
   - `receipt_hash` TEXT NOT NULL
   - `published_at` DATETIME NOT NULL

6. `removal_reports`
   - `id` TEXT PRIMARY KEY
   - `contribution_id` TEXT NOT NULL (FK -> `sanitized_contributions.id` ON DELETE CASCADE)
   - `plugin_slug` TEXT NOT NULL
   - `reason` TEXT NOT NULL
   - `reporter_ref` TEXT NOT NULL
   - `status` TEXT NOT NULL DEFAULT 'pending'
   - `reported_at` DATETIME NOT NULL
   - `processed_at` DATETIME

7. `sync_watermarks`
   - `stream_id` TEXT PRIMARY KEY
   - `last_seq` INTEGER NOT NULL DEFAULT 0
   - `last_checkpoint` TEXT NOT NULL DEFAULT ''
   - `updated_at` DATETIME NOT NULL

## Lifecycle & Adversarial Verification
- Verified end-to-end transition: `queued` -> `sanitizing` -> `approved` -> `exported` -> `delivered` (via `publication_receipts`) -> `tombstoned` (via `removal_reports`).
- Foreign keys and unique constraints enforced under `PRAGMA foreign_keys = ON`.
- All tests in `agentic-os/internal/localdb/community/...` pass.
