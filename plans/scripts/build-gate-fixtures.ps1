<#
.SYNOPSIS
  Build lane-3 gate fixtures (S02-L3-004A): contract-conformant GO tree and
  intentionally broken NO-GO tree under plans/scripts/fixtures/.

.DESCRIPTION
  Test-only fixtures. Real SQLite files built by Python stdlib sqlite3, plus
  minimal .go source files as static-scan evidence (labeled FIXTURE EVIDENCE,
  not producer code, never claimed as live).

  Layout mirrors a repo root:
    fixtures/go/   go/internal/localdb/{sen-product.db, community-queue.db,
                   community/sanitizer.go}
    fixtures/nogo/ go/internal/localdb/{...broken..., extra-metrics.db,
                   community/store.go with PostgreSQL DSN}

  Rebuild:  powershell -File build-gate-fixtures.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$fixturesRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$fixturesRoot = Join-Path $fixturesRoot 'fixtures'

$python = $null
foreach ($candidate in @('python', 'py', 'python3')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $candidate; break }
}
if (-not $python) { Write-Error 'no python found'; exit 2 }
$pyArgs = @()
if ($python -eq 'py') { $pyArgs += '-3' }

$builder = @'
import os, sqlite3, sys

root = sys.argv[1]
TS = "2026-08-25T00:00:00.000Z"

def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)

def build_db(path, ddl, journal="WAL", sync="FULL"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode = %s" % journal)
    con.execute("PRAGMA synchronous = %s" % sync)
    con.executescript(ddl)
    con.commit()
    if journal == "WAL":
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    for suffix in ("-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)

# --- GO tree: frozen AO-14 / AO-15 exact ------------------------------------
SEN_GO = """
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE sen_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, metadata JSON, created_at TEXT NOT NULL);
CREATE TABLE run_refs (run_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT, summary TEXT, started_at TEXT NOT NULL, ended_at TEXT, metadata JSON, synced_at TEXT NOT NULL);
CREATE TABLE command_receipts (command_id TEXT PRIMARY KEY, command_type TEXT NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL, payload JSON, result JSON, error TEXT, executed_at TEXT NOT NULL);
CREATE TABLE export_candidates (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, export_format TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','exported','failed','quarantined')), created_at TEXT NOT NULL, exported_at TEXT);
CREATE TABLE audit_events (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_sen_messages_session ON sen_messages(session_id, created_at);
CREATE INDEX idx_run_refs_goal ON run_refs(goal_id);
CREATE INDEX idx_export_status ON export_candidates(status);
INSERT INTO schema_migrations VALUES ('0001_init','%s');
""" % TS

CQ_GO = """
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE sanitized_contributions (id TEXT PRIMARY KEY, source TEXT NOT NULL, payload_hash TEXT NOT NULL UNIQUE, raw_payload JSON NOT NULL, sanitized_payload JSON, status TEXT NOT NULL CHECK(status IN ('pending','sanitizing','sanitized','quarantined','rejected')), quarantine_reason TEXT, created_at TEXT NOT NULL, processed_at TEXT);
CREATE TABLE delivery_attempts (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE, target_destination TEXT NOT NULL, attempt_number INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('enqueued','sending','succeeded','failed','quarantined')), error TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE publication_receipts (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE, receipt_hash TEXT NOT NULL UNIQUE, published_to TEXT NOT NULL, metadata JSON, published_at TEXT NOT NULL);
CREATE TABLE removal_reports (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE sync_watermarks (stream TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
CREATE INDEX idx_contrib_hash ON sanitized_contributions(payload_hash);
CREATE INDEX idx_contrib_status ON sanitized_contributions(status);
CREATE INDEX idx_delivery_status ON delivery_attempts(status);
CREATE TRIGGER sanitized_contributions_terminal_guard
BEFORE UPDATE OF status ON sanitized_contributions
WHEN OLD.status = 'rejected' AND NEW.status != 'rejected'
BEGIN
    SELECT RAISE(ABORT, 'rejected contributions are terminal');
END;
INSERT INTO schema_migrations VALUES ('0001_init','%s');
""" % TS

go_root = os.path.join(root, "go", "go", "internal", "localdb")
build_db(os.path.join(go_root, "sen-product.db"), SEN_GO)
build_db(os.path.join(go_root, "community-queue.db"), CQ_GO)
w(os.path.join(go_root, "community", "sanitizer.go"),
  """// FIXTURE EVIDENCE ONLY - lane 3 test fixture, not producer code.
package community

// allowlist of permitted metadata keys (fixture).
var allowedMetadataKeys = map[string]bool{"category": true, "tag": true}

// forbidden secret patterns: bearer, jwt, api_key, private_key, password,
// token, secret, pem (fixture stand-ins for producer regexes).
var forbiddenPatterns = []string{"bearer", "jwt", "api_key", "private_key", "password", "token", "secret", "pem"}
""")
w(os.path.join(go_root, "core", "database.go"),
  """// FIXTURE EVIDENCE ONLY - lane 3 test fixture, not producer code.
package core

// fixture DSN with AO-14 six-pragma set.
const dsn = "file:sen-product.db?_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=cache_size(-64000)&_pragma=temp_store(MEMORY)"
""")

# --- NO-GO tree: intentionally broken ----------------------------------------
SEN_BAD = """
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE sen_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, metadata JSON, created_at TEXT NOT NULL);
CREATE TABLE run_refs (run_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, synced_at TEXT NOT NULL);
CREATE TABLE export_candidates (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, export_format TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, exported_at TEXT);
CREATE INDEX idx_sen_messages_session ON sen_messages(session_id, created_at);
CREATE INDEX idx_run_refs_goal ON run_refs(goal_id);
CREATE INDEX idx_export_status ON export_candidates(status);
INSERT INTO schema_migrations VALUES ('0001_init','%s');
""" % TS

CQ_BAD = """
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE sanitized_contributions (id TEXT PRIMARY KEY, source TEXT NOT NULL, payload_hash TEXT NOT NULL, raw_payload JSON NOT NULL, sanitized_payload JSON, status TEXT NOT NULL, quarantine_reason TEXT, created_at TEXT NOT NULL, processed_at TEXT);
CREATE TABLE delivery_attempts (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE, target_destination TEXT NOT NULL, attempt_number INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE publication_receipts (id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE, receipt_hash TEXT NOT NULL, published_to TEXT NOT NULL, metadata JSON, published_at TEXT NOT NULL);
CREATE TABLE sync_watermarks (stream TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
CREATE INDEX idx_contrib_hash ON sanitized_contributions(payload_hash);
CREATE INDEX idx_contrib_status ON sanitized_contributions(status);
CREATE INDEX idx_delivery_status ON delivery_attempts(status);
INSERT INTO schema_migrations VALUES ('0001_init','%s');
""" % TS

nogo_root = os.path.join(root, "nogo", "go", "internal", "localdb")
build_db(os.path.join(nogo_root, "sen-product.db"), SEN_BAD,
         journal="DELETE", sync="NORMAL")
build_db(os.path.join(nogo_root, "community-queue.db"), CQ_BAD,
         journal="DELETE", sync="NORMAL")
build_db(os.path.join(nogo_root, "extra-metrics.db"),
         "CREATE TABLE m (id INTEGER);")
w(os.path.join(nogo_root, "community", "store.go"),
  """// FIXTURE EVIDENCE ONLY - intentionally broken fixture, not producer code.
package community

// broken: local PostgreSQL assumption (forbidden).
const dsn = "postgres://localhost:5432/community?sslmode=disable"
""")
w(os.path.join(nogo_root, "community", "sanitizer.go"),
  """// FIXTURE EVIDENCE ONLY - intentionally broken fixture, not producer code.
package community

// broken: no allowlist, no secret patterns.
var allowedMetadataKeys = map[string]bool{"category": true}
""")

print("fixtures built under", root)
'@

$builderPath = Join-Path $env:TEMP 'sprint02-gate-fixture-builder.py'
Set-Content -Path $builderPath -Value $builder -Encoding UTF8
& $python @pyArgs $builderPath $fixturesRoot
if ($LASTEXITCODE -ne 0) { Write-Error 'fixture build failed'; exit 2 }
Write-Host "fixtures: $fixturesRoot\go and $fixturesRoot\nogo"
