# S02-L3-004E — Root cause: gate sidecar creation on promoted master

**Finding: gate opens original WAL databases with SQLite at all. Any SQLite
open of a WAL-mode database allocates the wal-index (`-shm`) and touches
`-wal` on first read — even with `mode=ro` — whenever the directory is
writable. Read-only closes do not remove them.** Diagnosis only; no gate,
fixture, producer, or master change made. FALLBACK experiments ran in temp
against freshly built throwaway DBs.

## Mechanism (empirically reproduced, 2026-08-25)

Throwaway WAL database, checkpointed, sidecars deleted, then:

| Open mode | During open | After close | journal_mode read | Rows read |
|---|---|---|---|---|
| `file:db?mode=ro` | `db-shm`, `db-wal` **created** | **persist** | `wal` (correct) | correct |
| `file:db?immutable=1` | none | none | `delete` (**wrong**) | correct on checkpointed file |
| `mode=ro` with live 4152-byte `-wal` (writer held open) | recovery reads frames | n/a | `wal` | correct (1 row) |
| `immutable=1` same live WAL | none | none | `delete` | **0 rows — stale read** |

Chain of causation:

1. Producer databases are WAL-mode; WAL is a persistent per-file property.
2. The materializer (`wal_checkpoint(TRUNCATE)` + clean close) leaves pure
   single files — so promoted snapshots start sidecar-free.
3. Gate static layer (`connect()` in `sprint02-gate.ps1`) opens originals
   `mode=ro`. SQLite must build the wal-index to read a WAL database; with a
   writable directory it creates `-shm`/`-wal` during recovery on the first
   statement. Gate scenario layer (`backup_copy`) opens originals the same
   way — both layers implicated.
4. A read-only connection never takes write/exclusive locks, so the close
   path skips the checkpoint-and-delete that a writer's last close performs
   (verified: when a writer connection is present, final close removes
   sidecars; with only ro connections, they persist).
5. Original `.db` bytes stay untouched — but the directory now holds
   artifacts the promotion manifest does not, breaking hash-evidence hygiene.

## immutable=1 verdict

**Unsafe for this gate, on two independent grounds:**

1. **Stale reads on live WAL**: `immutable=1` skips the wal-index entirely;
   committed-but-uncheckpointed frames are invisible (demonstrated: 0 rows
   vs 1). Safe only when the target is provably fully checkpointed — which is
   exactly the pre-condition option A already asserts for free.
2. **Falsifies WAL evidence**: `PRAGMA journal_mode` reads `delete` under
   immutable opens (demonstrated), so SP-WAL/CQ-WAL would false-FAIL a
   conformant database. The gate's core durability rule cannot be evaluated
   through immutable connections.

Verdict: `immutable=1` is safe only for checkpointed snapshots AND only when
WAL evidence is not needed — both disqualifying here.

## Recommended remediation (cause-aligned; not cleanup-as-fix)

**Option A (recommended): quiescence pre-check + raw byte-copy, originals
never opened by SQLite.**

1. Pre-check (new gate rule, e.g. `XG-QUIESCENT-SNAPSHOT`): target directory
   contains no `-wal`/`-shm` for either DB. If present and non-empty: exit 2
   (`GATE-ERROR: target not quiescent`), because the gate audits promoted
   checkpointed snapshots, not live databases. Materializer output passes by
   construction.
2. `shutil.copy2` both `.db` files to temp (raw bytes; valid exactly because
   checkpointed). Run all static AND scenario inspection on the copies.
   Copies report `journal_mode=wal` correctly and grow sidecars only in temp.
3. Originals are never opened by SQLite at all — sidecar creation becomes
   impossible by construction, not by cleanup.

Cost: two file copies; all 33 existing rules keep their evidence quality.

**Option B (rejected): accept sidecars + producer re-open cleans them.**
Violates no-original-mutation and leaves manifest drift on the promoted
snapshot; deletion afterwards is cleanup-as-fix, excluded.

**Option C (rejected): `immutable=1`.** See verdict above — stale reads and
falsified WAL evidence.

## Proof protocol: no sidecars before/after any gate run

```powershell
# BEFORE: enumerate target dir
Get-ChildItem <dbdir> -Filter "*.db*" |
  Select-Object Name, Length, @{n='SHA256';e={(Get-FileHash $_.FullName -Algorithm SHA256).Hash}}
# must show exactly 2 entries (sen-product.db, community-queue.db), no -wal/-shm

# run gate

# AFTER: same enumeration — require:
#   1. identical entry set (no new -wal/-shm, none missing)
#   2. identical SHA-256 for both main files
```

This double assertion (set equality + hash equality) proves both "no
sidecars created" and "original bytes untouched" and should accompany every
promoted-master gate report as pasted evidence.

## Unresolved questions

- None.

JOB_DONE: S02-L3-004E.
