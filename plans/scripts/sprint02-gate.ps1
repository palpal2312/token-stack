<#
.SYNOPSIS
  Sprint 02 pre-registered gate v2 (S02-L3-001 static + S02-L3-004A integrated).

.DESCRIPTION
  Read-only machine gate over Sprint 2 SQLite output. v1 static rules
  (SP-*/CQ-*) are byte-equivalent to the S02-L3-001 pre-registration; v2 adds
  the integrated crash/replay/privacy layer (XG-*/SC-*) pre-registered under
  S02-L3-004A. No existing rule or threshold was weakened.

  Verdict:  GATE: GO | GATE: NO-GO [RULE-CODE,...]
  Exit:     0 = GO, 1 = NO-GO, 2 = gate infrastructure error.

  Live scenarios (SC-*) run on BACKUP-API COPIES of the target databases in a
  temp dir. Originals are never opened for write. No mocks: copies are real
  SQLite files exercised through real connections.

.PARAMETER SourceRoot
  Repository/worktree root containing go/internal/localdb.

.PARAMETER DbDir
  Directory holding both .db files (skips recursive search).

.PARAMETER SenDbPath / CqDbPath
  Explicit per-database paths (win over every search).

.PARAMETER RunScenarios
  Execute SC-* live crash/replay/receipt/watermark scenarios on temp copies.

.PARAMETER RunProducerTests
  Run producer focused go tests (adversarial/sanitizer/crash families)
  read-only as SC-PRODUCER-TESTS. Skipped (WARN) when no go module found.

.PARAMETER PythonExe
  Python interpreter override (stdlib sqlite3 required).

.PARAMETER OutJson
  Optional path for machine-readable result JSON.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [string]$DbDir,
    [string]$SenDbPath,
    [string]$CqDbPath,
    [switch]$RunScenarios,
    [switch]$RunProducerTests,
    [string]$PythonExe,
    [string]$OutJson
)

$ErrorActionPreference = 'Stop'

function Gate-Fatal([string]$Message) {
    # Plain stderr + deterministic exit 2 (Write-Error would throw first
    # under ErrorActionPreference=Stop and surface as exit 1).
    [Console]::Error.WriteLine("GATE-ERROR: $Message")
    exit 2
}

if (-not (Test-Path $SourceRoot)) {
    Gate-Fatal "SourceRoot not found: $SourceRoot"
}

# --- Resolve python (engine: stdlib sqlite3; no sqlite3 CLI on this box) ----
$python = $PythonExe
if (-not $python) {
    foreach ($candidate in @('python', 'py', 'python3')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { $python = $candidate; break }
    }
}
if (-not $python) {
    Gate-Fatal "no python interpreter found (need stdlib sqlite3). Pass -PythonExe."
}
$pyArgs = @()
if ($python -eq 'py') { $pyArgs += '-3' }

# --- Locate database files --------------------------------------------------
function Find-Db([string]$Name, [string]$Explicit) {
    if ($Explicit) {
        if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }
        return $null
    }
    if ($DbDir) {
        $p = Join-Path $DbDir $Name
        if (Test-Path $p) { return (Resolve-Path $p).Path }
        return $null
    }
    $roots = @(
        (Join-Path $SourceRoot 'go\internal\localdb'),
        (Join-Path $SourceRoot 'go'),
        $SourceRoot
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $hit = Get-ChildItem -Path $root -Recurse -File -Filter $Name `
               -ErrorAction SilentlyContinue |
               Where-Object { $_.FullName -notmatch 'node_modules|\.git[\\/]' } |
               Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

$senDb = Find-Db 'sen-product.db' $SenDbPath
$cqDb  = Find-Db 'community-queue.db' $CqDbPath

# --- Embedded check engine (python stdlib only) ------------------------------
$engine = @'
import hashlib, json, os, re, shutil, sqlite3, subprocess, sys, tempfile

(sen_db, cq_db, source_root, run_scenarios,
 run_producer_tests) = sys.argv[1:6]
results = []  # {rule, status: PASS|FAIL|WARN, detail}

def emit(rule, status, detail):
    results.append({"rule": rule, "status": status, "detail": detail})

def connect(path):
    # Read-only inspection connection. No PRAGMAs are set here: per-connection
    # settings (foreign_keys et al.) set by the gate would prove nothing
    # about producer configuration (S02-L3-004C).
    return sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"),
                           uri=True)

def pragma(con, name):
    return con.execute("PRAGMA %s" % name).fetchone()[0]

def tables(con):
    return {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}

def indexes(con):
    return {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='index'")}

def columns(con, name):
    return {r[1] for r in con.execute("PRAGMA table_info(%s)" % name)}

def table_sql(con, name):
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone()
    return row[0] if row else ""

def all_columns(con):
    cols = set()
    for t in tables(con):
        for r in con.execute("PRAGMA table_info(%s)" % t):
            cols.add(r[1].lower())
    return cols

def check_db(path, prefix, required_tables, required_indexes):
    """v1 shared checks (S02-L3-001, thresholds unchanged)."""
    if not path or path == "__MISSING__" or not os.path.isfile(path):
        emit(prefix + "-FILE", "FAIL", "database file not found")
        return None
    emit(prefix + "-FILE", "PASS", path)
    try:
        con = connect(path)
    except Exception as exc:
        emit(prefix + "-OPEN", "FAIL", "cannot open read-only: %s" % exc)
        return None

    jm = str(pragma(con, "journal_mode")).lower()
    emit(prefix + "-WAL", "PASS" if jm == "wal" else "FAIL",
         "journal_mode=%s (contract: WAL)" % jm)

    sync = int(pragma(con, "synchronous"))
    emit(prefix + "-SYNC-FULL", "PASS" if sync == 2 else "FAIL",
         "synchronous=%d (contract: FULL=2)" % sync)

    busy = int(pragma(con, "busy_timeout"))
    emit(prefix + "-BUSY", "PASS" if 0 < busy <= 30000 else "FAIL",
         "busy_timeout=%d (contract: bounded, e.g. 5000)" % busy)

    # NOTE: no *-FK rule here (S02-L3-004C). foreign_keys is per-connection;
    # setting then reading it was tautological. Evidence chain: XG-FK-SOURCE
    # (static) + SC-FK-ENFORCED (live schema enforcement) + producer tests.

    have = tables(con)
    missing = sorted(set(required_tables) - have)
    emit(prefix + "-TABLES", "PASS" if not missing else "FAIL",
         "missing: %s" % ", ".join(missing) if missing else
         "all %d required tables present" % len(required_tables))

    have_idx = indexes(con)
    missing_idx = sorted(set(required_indexes) - have_idx)
    emit(prefix + "-INDEXES", "PASS" if not missing_idx else "FAIL",
         "missing: %s" % ", ".join(missing_idx) if missing_idx else
         "all %d required indexes present" % len(required_indexes))

    if "schema_migrations" in have:
        n = con.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
        emit(prefix + "-MIGRATIONS", "PASS" if n >= 1 else "FAIL",
             "schema_migrations rows=%d" % n)
    return con

# === v1 static layer (S02-L3-001) ===========================================
SEN_TABLES = ["schema_migrations", "sen_messages", "run_refs",
              "command_receipts", "export_candidates"]
SEN_INDEXES = ["idx_sen_messages_session", "idx_run_refs_goal",
               "idx_export_status"]
sen_con = check_db(sen_db, "SP", SEN_TABLES, SEN_INDEXES)
if sen_con:
    have = tables(sen_con)
    audit_like = sorted(t for t in have
                        if t.startswith("audit") or "outbox" in t)
    # S02-L3-004B (controller-authorized): AO-14-pinned command_receipts
    # (append-only audit) + export_candidates (durable outbox) satisfy map
    # L72; audit_*/*outbox* names remain an additional accept, not a demand.
    ao14_pair = "command_receipts" in have and "export_candidates" in have
    emit("SP-AUDIT-OUTBOX", "PASS" if (audit_like or ao14_pair) else "FAIL",
         "audit/outbox tables: %s" % ", ".join(audit_like) if audit_like
         else ("AO-14 audit/outbox pair: command_receipts + "
               "export_candidates" if ao14_pair else
               "no audit_*/*outbox* table and missing AO-14 "
               "command_receipts/export_candidates pair (map L72)"))

    sql = table_sql(sen_con, "export_candidates")
    has_check = bool(re.search(r"CHECK\s*\(", sql, re.I))
    emit("SP-EXPORT-STATUS-CHECK", "PASS" if has_check else "FAIL",
         "export_candidates.status CHECK constraint present" if has_check
         else "export_candidates.status lacks CHECK (AO-14)")

    ts_checked = bool(re.search(r"created_at[^,]*CHECK", sql, re.I))
    emit("SP-TS-RFC3339-CHECK", "WARN",
         "timestamp CHECK constraints %s; AO-14 SQL omits them, validation "
         "report requests them - WARN until contracts reconciled"
         % ("present" if ts_checked else "absent"))

CQ_TABLES = ["schema_migrations", "sanitized_contributions",
             "delivery_attempts", "publication_receipts",
             "removal_reports", "sync_watermarks"]
CQ_INDEXES = ["idx_contrib_hash", "idx_contrib_status", "idx_delivery_status"]
cq_con = check_db(cq_db, "CQ", CQ_TABLES, CQ_INDEXES)
if cq_con:
    have = tables(cq_con)

    for tname in ("sanitized_contributions", "delivery_attempts"):
        sql = table_sql(cq_con, tname)
        ok = bool(re.search(r"status[^,]*CHECK\s*\(|CHECK\s*\([^)]*status",
                            sql, re.I)) if sql else False
        emit("CQ-STATUS-CHECK-" + tname.split("_")[0].upper(),
             "PASS" if ok else "FAIL",
             "%s.status CHECK %s (frozen AO-15)" % (
                 tname, "present" if ok else "missing"))

    def has_unique(tname, col):
        if tname not in tables(cq_con):
            return False
        for r in cq_con.execute("PRAGMA index_list(%s)" % tname):
            if r[2]:
                cols = [c[2] for c in
                        cq_con.execute("PRAGMA index_info(%s)" % r[1])]
                if cols == [col]:
                    return True
        return bool(re.search(col + r"[^,]*UNIQUE",
                              table_sql(cq_con, tname), re.I))
    emit("CQ-UNIQUE-PAYLOAD-HASH",
         "PASS" if has_unique("sanitized_contributions", "payload_hash")
         else "FAIL", "payload_hash UNIQUE (frozen AO-15)")
    emit("CQ-UNIQUE-RECEIPT-HASH",
         "PASS" if has_unique("publication_receipts", "receipt_hash")
         else "FAIL", "receipt_hash UNIQUE (frozen AO-15)")

    fk_ok = True
    for tname, ref in [("delivery_attempts", "sanitized_contributions"),
                       ("publication_receipts", "sanitized_contributions")]:
        refs = {r[2] for r in cq_con.execute(
            "PRAGMA foreign_key_list(%s)" % tname)} if tname in have else set()
        if ref not in refs:
            fk_ok = False
    emit("CQ-FK-DECL", "PASS" if fk_ok else "FAIL",
         "delivery_attempts/publication_receipts reference "
         "sanitized_contributions" if fk_ok else
         "missing FK to sanitized_contributions (AO-15)")

    deny = {"prompt", "token", "secret", "password", "api_key",
            "apikey", "terminal_output", "private_key"}
    hits = sorted(all_columns(cq_con) & deny)
    emit("CQ-PRIVACY-SCAN", "WARN" if hits else "PASS",
         "suspicious columns: %s" % ", ".join(hits) if hits
         else "no denylisted column names")

# === v2 integrated layer (S02-L3-004A) ======================================
localdb_root = os.path.join(source_root, "go", "internal", "localdb")
if not os.path.isdir(localdb_root):
    localdb_root = ""

# XG-DB-INVENTORY: exactly two DB identities, distinct files, no extra .db.
inv_root = localdb_root or (os.path.dirname(sen_db)
                            if sen_db and sen_db != "__MISSING__" else "")
extras, inv_ok, detail = [], True, ""
if sen_db != "__MISSING__" and cq_db != "__MISSING__" and \
        os.path.abspath(sen_db) == os.path.abspath(cq_db):
    inv_ok = False
    detail = "sen-product.db and community-queue.db resolve to the same file"
if inv_root and os.path.isdir(inv_root):
    found = []
    for dirpath, _dirs, files in os.walk(inv_root):
        for f in files:
            if f.endswith(".db"):
                found.append(f)
    expected = {"sen-product.db", "community-queue.db"}
    extras = sorted(set(found) - expected)
    missing = sorted(expected - set(found))
    if extras:
        inv_ok = False
        detail = "unexpected .db files under localdb: %s" % ", ".join(extras)
    elif missing:
        inv_ok = False
        detail = "missing DB identities: %s" % ", ".join(missing)
    elif not detail:
        detail = "exactly two DB identities: %s" % ", ".join(sorted(set(found)))
emit("XG-DB-INVENTORY", "PASS" if inv_ok else "FAIL",
     detail or "two distinct DB identity files")

# XG-NO-PG: no local PostgreSQL DSN in localdb sources (static proxy).
pg_hits = []
pg_re = re.compile(r"postgres(ql)?://|sql\.Open\(\s*\"postgres|"
                   r"host=\S+[^)]*dbname=", re.I)
if localdb_root:
    for dirpath, _dirs, files in os.walk(localdb_root):
        for f in files:
            if f.endswith(".go") and not f.endswith("_test.go"):
                p = os.path.join(dirpath, f)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    for i, line in enumerate(fh, 1):
                        if pg_re.search(line):
                            pg_hits.append("%s:%d" % (p, i))
emit("XG-NO-PG", "PASS" if not (localdb_root and pg_hits) else "FAIL",
     "PostgreSQL DSN at %s" % "; ".join(pg_hits) if pg_hits else
     ("no localdb source tree to scan" if not localdb_root
      else "no PostgreSQL DSN/process assumption in localdb sources"))

# XG-FK-SOURCE (S02-L3-004C): foreign_keys=ON connection evidence (static).
# Replaces the tautological set-then-read SP-FK/CQ-FK rules.
fk_re = re.compile(r"foreign_keys\s*\(\s*ON\s*\)|"
                   r"PRAGMA\s+foreign_keys\s*=\s*ON", re.I)
fk_hits = []
if localdb_root:
    for dirpath, _dirs, files in os.walk(localdb_root):
        for f in files:
            if f.endswith(".go") and not f.endswith("_test.go"):
                p = os.path.join(dirpath, f)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    if fk_re.search(fh.read()):
                        fk_hits.append(p)
emit("XG-FK-SOURCE", "PASS" if fk_hits else "FAIL",
     "foreign_keys=ON connection evidence at %s" % "; ".join(fk_hits)
     if fk_hits else
     "no foreign_keys=ON DSN/pragma in localdb connection sources")

# XG-SANITIZER-SOURCE: forbidden-field sanitizer evidence (static).
san_ok, san_detail = False, "no sanitizer source found under localdb"
secret_tokens = ["bearer", "jwt", "api_key", "apikey", "private",
                 "password", "token", "secret", "pem"]
if localdb_root:
    for dirpath, _dirs, files in os.walk(localdb_root):
        for f in files:
            if f.endswith(".go") and not f.endswith("_test.go"):
                p = os.path.join(dirpath, f)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    body = fh.read().lower()
                if "allow" not in body:
                    continue
                hits = [t for t in secret_tokens if t in body]
                if ("allowlist" in body or "allowed" in body) and \
                        len(hits) >= 3:
                    san_ok = True
                    san_detail = ("%s: allowlist + %d secret-pattern tokens "
                                  "(%s)" % (p, len(hits), ", ".join(hits)))
                    break
        if san_ok:
            break
emit("XG-SANITIZER-SOURCE", "PASS" if san_ok else "FAIL", san_detail)

# SP-CACHE-TEMP (S02-L3-004B, controller-authorized): AO-14 freezes all six
# pragmas incl. cache_size=-64000 and temp_store=MEMORY. Both are
# per-connection (not persisted in the DB file), so evidence is the producer
# DSN/pragma source plus producer live tests (SC-PRODUCER-TESTS); a fresh
# gate connection cannot observe runtime values.
cache_re = re.compile(r"cache_size\s*[=(]?\s*-64000", re.I)
temp_re = re.compile(r"temp_store\s*[=(]?\s*(MEMORY|2)\b", re.I)
cache_hit = temp_hit = None
if localdb_root:
    for dirpath, _dirs, files in os.walk(localdb_root):
        for f in files:
            if f.endswith(".go") and not f.endswith("_test.go"):
                p = os.path.join(dirpath, f)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    body = fh.read()
                if not cache_hit and cache_re.search(body):
                    cache_hit = p
                if not temp_hit and temp_re.search(body):
                    temp_hit = p
        if cache_hit and temp_hit:
            break
pt_ok = bool(cache_hit and temp_hit)
pt_detail = []
pt_detail.append("cache_size=-64000 at %s" % cache_hit if cache_hit
                 else "cache_size(-64000) not found in localdb sources")
pt_detail.append("temp_store=MEMORY at %s" % temp_hit if temp_hit
                 else "temp_store(MEMORY) not found in localdb sources")
emit("SP-CACHE-TEMP", "PASS" if pt_ok else "FAIL",
     "; ".join(pt_detail) + " (static source evidence; runtime values are "
     "per-connection and covered by SC-PRODUCER-TESTS)")

# XG-PRODUCT-STANDALONE: product section evaluated without community DB.
sp_fails = [r["rule"] for r in results
            if r["rule"].startswith("SP-") and r["status"] == "FAIL"]
emit("XG-PRODUCT-STANDALONE", "PASS" if not sp_fails else "FAIL",
     "product DB checks evaluated independently of community DB; "
     "SP failures: %s" % ", ".join(sp_fails) if sp_fails else
     "product DB checks pass regardless of community DB availability")

# XG-REPLAY-ANCHORS: idempotency anchors for crash-window replay.
anchors_ok, anchor_missing = True, []
if sen_con and "export_candidates" in tables(sen_con):
    if "content_hash" not in columns(sen_con, "export_candidates"):
        anchors_ok = False
        anchor_missing.append("export_candidates.content_hash")
if cq_con and "sanitized_contributions" in tables(cq_con):
    if "payload_hash" not in columns(cq_con, "sanitized_contributions"):
        anchors_ok = False
        anchor_missing.append("sanitized_contributions.payload_hash")
emit("XG-REPLAY-ANCHORS", "PASS" if anchors_ok else "FAIL",
     "stable anchors: export_candidates.content_hash + "
     "sanitized_contributions.payload_hash" if anchors_ok else
     "missing idempotency anchors: %s" % ", ".join(anchor_missing))

# --- SC-* live scenarios (temp backup-API copies; originals read-only) ------
def backup_copy(src, dst):
    s = sqlite3.connect("file:%s?mode=ro" % src.replace("\\", "/"), uri=True)
    d = sqlite3.connect(dst)
    s.backup(d)
    d.close()
    s.close()

def sc_guard(rule, fn, *args):
    try:
        fn(*args)
    except Exception as exc:
        emit(rule, "FAIL", "%s: %s" % (type(exc).__name__, exc))

if run_scenarios == "1":
    if not sen_con or not cq_con:
        emit("SC-CRASH-REPLAY", "FAIL",
             "scenarios require both databases present")
    else:
        tmp = tempfile.mkdtemp(prefix="s02gate-sc-")
        try:
            sen_c = os.path.join(tmp, "sen-copy.db")
            cq_c = os.path.join(tmp, "cq-copy.db")
            backup_copy(sen_db, sen_c)
            backup_copy(cq_db, cq_c)

            def sc_crash_replay():
                H = hashlib.sha256(b"gate-scenario-payload").hexdigest()
                TS = "2026-08-25T00:00:00.000Z"
                # product commits candidate, then crash (close)
                con = sqlite3.connect(sen_c)
                con.execute(
                    "INSERT INTO export_candidates (id, source_type, "
                    "source_id, export_format, content_hash, status, "
                    "created_at) VALUES ('gate-sc-cand-1','gate',"
                    "'gate-sc-1','json',?,'pending',?)", (H, TS))
                con.commit()
                con.close()
                # handoff attempt: crash before candidate marked exported
                con2 = sqlite3.connect(cq_c)
                con2.execute(
                    "INSERT INTO sanitized_contributions (id, source, "
                    "payload_hash, raw_payload, status, created_at) VALUES "
                    "('gate-sc-contrib-1','export_candidate',?,'{}',"
                    "'pending',?)", (H, TS))
                con2.commit()
                con2.close()
                # reopen + idempotent replay (different row id, same hash)
                con2 = sqlite3.connect(cq_c)
                cur = con2.execute(
                    "INSERT OR IGNORE INTO sanitized_contributions (id, "
                    "source, payload_hash, raw_payload, status, created_at) "
                    "VALUES ('gate-sc-contrib-1-retry','export_candidate',?,"
                    "'{}','pending',?)", (H, TS))
                replay_blocked = cur.rowcount == 0
                n = con2.execute(
                    "SELECT COUNT(*) FROM sanitized_contributions WHERE "
                    "payload_hash=?", (H,)).fetchone()[0]
                con2.commit()
                con2.close()
                # candidate marked exported only after community row exists
                con = sqlite3.connect(sen_c)
                con.execute(
                    "UPDATE export_candidates SET status='exported', "
                    "exported_at='2026-08-25T00:00:01.000Z' WHERE "
                    "id='gate-sc-cand-1'")
                st = con.execute(
                    "SELECT status FROM export_candidates WHERE "
                    "id='gate-sc-cand-1'").fetchone()[0]
                con.commit()
                con.close()
                if not replay_blocked or n != 1:
                    raise RuntimeError(
                        "replay inserted duplicate (rows=%d); payload_hash "
                        "UNIQUE anchor missing" % n)
                if st != "exported":
                    raise RuntimeError("candidate status=%s" % st)
                emit("SC-CRASH-REPLAY", "PASS",
                     "crash before export-mark; replay blocked by "
                     "payload_hash UNIQUE; exactly 1 row; candidate exported")
            sc_guard("SC-CRASH-REPLAY", sc_crash_replay)

            def sc_receipt_unique():
                con = sqlite3.connect(cq_c)
                RH = hashlib.sha256(b"gate-scenario-receipt").hexdigest()
                con.execute(
                    "INSERT INTO publication_receipts (id, contribution_id, "
                    "receipt_hash, published_to, published_at) VALUES "
                    "('gate-sc-rcpt-1','gate-sc-contrib-1',?,'gate-sink',"
                    "'2026-08-25T00:00:03.000Z')", (RH,))
                con.commit()
                try:
                    con.execute(
                        "INSERT INTO publication_receipts (id, "
                        "contribution_id, receipt_hash, published_to, "
                        "published_at) VALUES ('gate-sc-rcpt-2',"
                        "'gate-sc-contrib-1',?,'gate-sink',"
                        "'2026-08-25T00:00:04.000Z')", (RH,))
                    con.commit()
                    raise RuntimeError(
                        "duplicate receipt_hash accepted; UNIQUE missing")
                except sqlite3.IntegrityError:
                    con.rollback()
                n = con.execute(
                    "SELECT COUNT(*) FROM publication_receipts WHERE "
                    "receipt_hash=?", (RH,)).fetchone()[0]
                con.close()
                if n != 1:
                    raise RuntimeError("receipt rows=%d after replay" % n)
                emit("SC-RECEIPT-UNIQUE", "PASS",
                     "duplicate receipt_hash rejected by UNIQUE; 1 row kept")
            sc_guard("SC-RECEIPT-UNIQUE", sc_receipt_unique)

            def sc_fk_enforced():
                # Live: declared FKs must actually reject orphans when the
                # connection enables enforcement (S02-L3-004C chain link).
                con = sqlite3.connect(cq_c)
                con.execute("PRAGMA foreign_keys=ON")
                try:
                    con.execute(
                        "INSERT INTO delivery_attempts (id, "
                        "contribution_id, target_destination, status, "
                        "created_at) VALUES ('gate-sc-orphan',"
                        "'no-such-contribution','gate-sink','enqueued',"
                        "'2026-08-25T00:00:05.000Z')")
                    con.commit()
                    raise RuntimeError(
                        "orphan delivery_attempt accepted; declared FKs "
                        "not enforceable")
                except sqlite3.IntegrityError:
                    con.rollback()
                con.close()
                emit("SC-FK-ENFORCED", "PASS",
                     "orphan delivery_attempt rejected under FK-ON "
                     "connection; declared FKs enforceable")
            sc_guard("SC-FK-ENFORCED", sc_fk_enforced)

            def sc_terminal_guard():
                # S02-L3-004D: terminal-state invariant must hold at DB level
                # (trigger/invariant), not only in producer API code.
                con = sqlite3.connect(cq_c)
                H2 = hashlib.sha256(b"gate-scenario-terminal").hexdigest()
                TS = "2026-08-25T00:00:00.000Z"
                con.execute(
                    "INSERT OR IGNORE INTO sanitized_contributions (id, "
                    "source, payload_hash, raw_payload, status, created_at) "
                    "VALUES ('gate-sc-term-1','gate',?,'{}','pending',?)",
                    (H2, TS))
                con.execute(
                    "UPDATE sanitized_contributions SET status='pending' "
                    "WHERE id='gate-sc-term-1'")
                con.commit()
                # valid pre-terminal quarantine must remain allowed
                try:
                    con.execute(
                        "UPDATE sanitized_contributions SET "
                        "status='quarantined' WHERE id='gate-sc-term-1'")
                    con.commit()
                except sqlite3.Error as exc:
                    con.close()
                    raise RuntimeError(
                        "pre-terminal quarantine blocked: %s" % exc)
                # drive to terminal (tombstone)
                con.execute(
                    "UPDATE sanitized_contributions SET status='rejected' "
                    "WHERE id='gate-sc-term-1'")
                con.commit()
                # resurrection attempts must be rejected by DB invariant
                for target in ("quarantined", "pending"):
                    try:
                        con.execute(
                            "UPDATE sanitized_contributions SET status=? "
                            "WHERE id='gate-sc-term-1'", (target,))
                        con.commit()
                        st = con.execute(
                            "SELECT status FROM sanitized_contributions "
                            "WHERE id='gate-sc-term-1'").fetchone()[0]
                        if st == target:
                            con.close()
                            raise RuntimeError(
                                "rejected -> %s resurrection accepted; no "
                                "DB-level terminal guard" % target)
                    except sqlite3.IntegrityError:
                        con.rollback()
                st = con.execute(
                    "SELECT status FROM sanitized_contributions WHERE "
                    "id='gate-sc-term-1'").fetchone()[0]
                con.close()
                if st != "rejected":
                    raise RuntimeError(
                        "terminal status drifted to %s after blocked "
                        "attempts" % st)
                emit("SC-TERMINAL-GUARD", "PASS",
                     "pre-terminal quarantine allowed; rejected->quarantined "
                     "and rejected->pending blocked by DB invariant")
            sc_guard("SC-TERMINAL-GUARD", sc_terminal_guard)

            def sc_watermark_restart():
                cols = list(sqlite3.connect(cq_c).execute(
                    "PRAGMA table_info(sync_watermarks)"))
                text_col = next((c[1] for c in cols if c[5]), None)
                int_col = next((c[1] for c in cols
                                if "INT" in c[2].upper()), None)
                if not text_col or not int_col:
                    raise RuntimeError(
                        "sync_watermarks lacks pk + INTEGER seq columns")
                # NOT NULL columns without defaults must be supplied;
                # fill them deterministically by declared type.
                ins = {text_col: "gate-sc-stream", int_col: 7}
                for c in cols:
                    name, kind, notnull, dflt = c[1], c[2].upper(), c[3], c[4]
                    if name in ins or not notnull or dflt is not None:
                        continue
                    if "INT" in kind:
                        ins[name] = 0
                    else:
                        ins[name] = "2026-08-25T00:00:00.000Z"
                names = ", ".join(ins)
                marks = ", ".join("?" for _ in ins)
                con = sqlite3.connect(cq_c)
                con.execute(
                    "INSERT OR REPLACE INTO sync_watermarks (%s) VALUES (%s)"
                    % (names, marks), tuple(ins.values()))
                con.commit()
                con.close()  # simulated restart
                con = sqlite3.connect(cq_c)
                got = con.execute(
                    "SELECT %s FROM sync_watermarks WHERE %s='gate-sc-stream'"
                    % (int_col, text_col)).fetchone()
                con.close()
                if not got or got[0] != 7:
                    raise RuntimeError("watermark after restart: %r" % (got,))
                emit("SC-WATERMARK-RESTART", "PASS",
                     "watermark (%s=%s) survives close/reopen on %s" % (
                         text_col, 7, int_col))
            sc_guard("SC-WATERMARK-RESTART", sc_watermark_restart)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # SC-PRODUCER-TESTS: live proof via producer's own focused suites.
if run_producer_tests == "1":
    go_dir = os.path.join(source_root, "go")
    if not os.path.isfile(os.path.join(go_dir, "go.mod")):
        emit("SC-PRODUCER-TESTS", "WARN",
             "no go module under SourceRoot/go; skipped")
    else:
        pattern = ("Adversarial|Sanitiz|Crash|Replay|Quarantine|Receipt|"
                   "Watermark|Backup|Restore|Corrupt|Migration|Pragma|"
                   "Introspection|Conformance")
        try:
            proc = subprocess.run(
                ["go", "test", "-count=1", "-run", pattern,
                 "./internal/localdb/..."],
                cwd=go_dir, capture_output=True, text=True, timeout=420)
            tail = (proc.stdout + proc.stderr).strip().splitlines()
            tail = tail[-3:] if tail else ["(no output)"]
            emit("SC-PRODUCER-TESTS",
                 "PASS" if proc.returncode == 0 else "FAIL",
                 "go test rc=%d | %s" % (proc.returncode,
                                         " | ".join(tail)))
        except Exception as exc:
            emit("SC-PRODUCER-TESTS", "FAIL",
                 "%s: %s" % (type(exc).__name__, exc))

# --- verdict ------------------------------------------------------------------
fails = [r["rule"] for r in results if r["status"] == "FAIL"]
verdict = "GO" if not fails else "NO-GO"
print(json.dumps({"verdict": verdict, "failed_rules": fails,
                  "results": results}))
'@

$enginePath = Join-Path $env:TEMP 'sprint02-gate-engine.py'
Set-Content -Path $enginePath -Value $engine -Encoding UTF8

$senArg = '__MISSING__'; if ($null -ne $senDb) { $senArg = $senDb }
$cqArg  = '__MISSING__'; if ($null -ne $cqDb)  { $cqArg  = $cqDb }
$scFlag  = '0'; if ($RunScenarios)     { $scFlag  = '1' }
$ptFlag  = '0'; if ($RunProducerTests) { $ptFlag  = '1' }

$raw = & $python @pyArgs $enginePath $senArg $cqArg `
    (Resolve-Path $SourceRoot).Path $scFlag $ptFlag
if ($LASTEXITCODE -ne 0) {
    Gate-Fatal "engine failed: $raw"
}
try {
    $gate = $raw | ConvertFrom-Json
} catch {
    Gate-Fatal "engine output not JSON: $raw"
}

foreach ($r in $gate.results) {
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }[$r.status]
    Write-Host ("{0,-4} {1,-26} {2}" -f $r.status, $r.rule, $r.detail) `
        -ForegroundColor $color
}

if ($gate.verdict -eq 'GO') {
    Write-Host 'GATE: GO' -ForegroundColor Green
} else {
    Write-Host ("GATE: NO-GO [{0}]" -f ($gate.failed_rules -join ',')) `
        -ForegroundColor Red
}

if ($OutJson) {
    $gate | ConvertTo-Json -Depth 5 | Set-Content -Path $OutJson -Encoding UTF8
    Write-Host "result JSON: $OutJson"
}

if ($gate.verdict -eq 'GO') { exit 0 } else { exit 1 }
