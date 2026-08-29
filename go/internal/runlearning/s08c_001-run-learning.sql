-- Lane-local, unregistered Sprint 08-C fragment. Integration registration is separate.
CREATE TABLE IF NOT EXISTS run_learning_records (record_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forecast_feature_records (record_id TEXT PRIMARY KEY, run_learning_record_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contribution_candidates (record_id TEXT PRIMARY KEY, forecast_feature_record_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calibration_errors (record_id TEXT PRIMARY KEY, run_learning_record_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL);
