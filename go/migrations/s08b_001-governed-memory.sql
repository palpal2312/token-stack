-- Lane-local, unregistered Sprint 08-B migration fragment.
-- Registration and shared schema ordering are owned by the integration writer.
CREATE TABLE IF NOT EXISTS sen_memory_records (
  record_id TEXT PRIMARY KEY,
  memory_kind TEXT NOT NULL CHECK (memory_kind IN ('working','episodic','semantic','procedural')),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','quarantined','superseded','deleted')),
  content_ciphertext BLOB,
  content_hash TEXT NOT NULL,
  acl_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  source_stale INTEGER NOT NULL DEFAULT 0,
  supersedes_record_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sen_memory_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  record_id TEXT NOT NULL,
  related_record_id TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sen_memory_active_source ON sen_memory_records(lifecycle_state, source_stale);
