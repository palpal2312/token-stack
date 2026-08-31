#!/usr/bin/env python3
"""Copy-first SQLite inspector (Sprint 03 Lane 3).

Never opens the source DB. Copies db+wal+shm to a temp dir, opens the copy
read-only, and proves the source bytes and sidecar set are unchanged. This is
the hygiene fix for the Sprint 02 debt item: gate read-only inspection created
empty WAL/SHM sidecars beside checkpointed DB snapshots.

Usage: python sqlite-inspect.py <source.db> [--json out.json]
Exit 0 = source untouched and copy readable; 1 = violation.
"""
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

SIDECARS = ("", "-wal", "-shm")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect(source: Path) -> dict:
    source = source.resolve()
    before = {s: sha256(Path(str(source) + s)) for s in SIDECARS if Path(str(source) + s).exists()}
    with tempfile.TemporaryDirectory(prefix="s03-inspect-") as tmp:
        copy = Path(tmp) / source.name
        for suffix in SIDECARS:
            src = Path(str(source) + suffix)
            if src.exists():
                shutil.copyfile(src, Path(str(copy) + suffix))
        # Open the COPY read-only. immutable=0 so SQLite can still recover the
        # copied WAL; the source is never touched.
        con = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
        try:
            integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
            tables = {
                r[0]: con.execute(f'SELECT COUNT(*) FROM "{r[0]}"').fetchone()[0]
                for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            }
            schema = [r[0] for r in con.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")]
        finally:
            con.close()
    after = {s: sha256(Path(str(source) + s)) for s in SIDECARS if Path(str(source) + s).exists()}
    new_sidecars = sorted(set(after) - set(before))
    changed = [s for s in before if before[s] != after.get(s)]
    return {
        "source": str(source),
        "integrityCheck": integrity,
        "tables": tables,
        "schemaStatements": len(schema),
        "sourceBytesChanged": changed,
        "newSidecarFiles": new_sidecars,
        "ok": integrity == "ok" and not changed and not new_sidecars,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    out = None
    if "--json" in sys.argv:
        i = sys.argv.index("--json")
        out = sys.argv[i + 1]
    result = inspect(Path(sys.argv[1]))
    text = json.dumps(result, indent=2)
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
