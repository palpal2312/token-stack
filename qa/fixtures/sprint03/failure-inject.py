#!/usr/bin/env python3
"""Recovery / failure-injection runner (S03-L3-001).

Builds a synthetic SQLite chat store reconstructed from chat-contract.json,
injects each failure class from recovery-matrix.json, checks the invariant,
and emits machine-readable evidence. Fixture-level: cells against the real
Lane 1 canonical store stay pending-lane1 until that schema lands.

Usage: python failure-inject.py [--json out.json]
Exit 0 = every runnable cell passed.
"""
import json
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from pathlib import Path

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE chat_sessions(
  session_id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, status TEXT,
  selected_builder_policy TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT);
CREATE TABLE chat_turns(
  turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_seq INTEGER NOT NULL,
  role TEXT, message_kind TEXT, content TEXT, chat_attempt_id TEXT,
  client_command_id TEXT, recorded_at TEXT,
  UNIQUE(session_id, turn_seq));
CREATE TABLE chat_attempts(
  chat_attempt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
  input_first_turn_seq INTEGER, input_last_turn_seq INTEGER, ordinal INTEGER,
  state TEXT CHECK(state IN ('queued','claimed','running','succeeded','failed','cancelled','no_response')),
  builder_id TEXT, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE chat_events(
  chat_attempt_id TEXT NOT NULL, seq INTEGER NOT NULL, event_kind TEXT,
  payload TEXT, redaction_class TEXT NOT NULL DEFAULT 'none', recorded_at TEXT,
  PRIMARY KEY(chat_attempt_id, seq));
CREATE TABLE chat_command_receipts(
  command_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL, chat_attempt_id TEXT NOT NULL, status TEXT, created_at TEXT);
"""


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def fresh_db(tmp: str) -> Path:
    db = Path(tmp) / f"fi-{uuid.uuid4().hex[:8]}.db"
    con = sqlite3.connect(db)
    con.executescript(SCHEMA)
    con.close()
    return db


def seed_session(con, sid="s-fixture"):
    con.execute("INSERT INTO chat_sessions VALUES(?,?,?,?,?,?,?,?)",
                (sid, "ws", "fixture", "active", "default", 1, now(), now()))
    con.commit()


def send_turn(con, sid, command_id, content):
    """persist-before-ack write with command-id replay, as the contract states."""
    row = con.execute("SELECT * FROM chat_command_receipts WHERE command_id=?", (command_id,)).fetchone()
    if row:
        return {"commandId": row[0], "sessionId": row[1], "turnId": row[2], "turnSeq": row[3],
                "chatAttemptId": row[4], "status": row[5], "replayed": True}
    seq = con.execute("SELECT COALESCE(MAX(turn_seq),0)+1 FROM chat_turns WHERE session_id=?", (sid,)).fetchone()[0]
    turn_id, attempt_id = f"t-{uuid.uuid4()}", f"a-{uuid.uuid4()}"
    con.execute("INSERT INTO chat_turns VALUES(?,?,?,?,?,?,?,?,?)",
                (turn_id, sid, seq, "user", "text", content, attempt_id, command_id, now()))
    con.execute("INSERT INTO chat_command_receipts VALUES(?,?,?,?,?,?,?)",
                (command_id, sid, turn_id, seq, attempt_id, "persisted", now()))
    con.commit()
    return {"commandId": command_id, "sessionId": sid, "turnId": turn_id, "turnSeq": seq,
            "chatAttemptId": attempt_id, "status": "persisted", "replayed": False}


def cell(fid, passed, detail, level="fixture"):
    return {"id": fid, "status": "pass" if passed else "fail", "evidenceLevel": level, "detail": detail}


def fi01(tmp):
    db = fresh_db(tmp)
    con = sqlite3.connect(db)
    seed_session(con)
    con.execute("INSERT INTO chat_turns VALUES('t-x','s-fixture',1,'user','text','half','a-x','c-x',?)", (now(),))
    con.execute("INSERT INTO chat_events VALUES('a-x',1,'delta','{}','none',?)", (now(),))
    con.rollback()  # simulated crash before commit
    con.close()
    con = sqlite3.connect(db)  # reopen = recovery path
    turns = con.execute("SELECT COUNT(*) FROM chat_turns").fetchone()[0]
    events = con.execute("SELECT COUNT(*) FROM chat_events").fetchone()[0]
    ver = con.execute("SELECT version FROM chat_sessions").fetchone()[0]
    con.close()
    ok = turns == 0 and events == 0 and ver == 1
    return cell("FI-01", ok, f"after reopen: turns={turns} events={events} sessionVersion={ver}")


def fi02(tmp):
    db = fresh_db(tmp)
    con = sqlite3.connect(db)
    seed_session(con)
    cid = str(uuid.uuid4())
    first = send_turn(con, "s-fixture", cid, "hello")  # committed; ack "lost" after this line
    retry = send_turn(con, "s-fixture", cid, "hello")  # client retry same commandId
    rows = con.execute("SELECT COUNT(*) FROM chat_turns WHERE client_command_id=?", (cid,)).fetchone()[0]
    con.close()
    ok = retry["replayed"] and rows == 1 and first["turnId"] == retry["turnId"]
    return cell("FI-02", ok, f"replayed={retry['replayed']} turnRows={rows} sameTurnId={first['turnId'] == retry['turnId']}")


def fi03(tmp):
    db = fresh_db(tmp)
    con = sqlite3.connect(db)
    seed_session(con)
    cid = str(uuid.uuid4())
    a = send_turn(con, "s-fixture", cid, "ping")
    b = send_turn(con, "s-fixture", cid, "ping")  # acked retry
    rows = con.execute("SELECT COUNT(*) FROM chat_turns WHERE client_command_id=?", (cid,)).fetchone()[0]
    receipts = con.execute("SELECT COUNT(*) FROM chat_command_receipts WHERE command_id=?", (cid,)).fetchone()[0]
    con.close()
    identical = all(a[k] == b[k] for k in ("turnId", "turnSeq", "chatAttemptId"))
    ok = rows == 1 and receipts == 1 and identical
    return cell("FI-03", ok, f"turnRows={rows} receipts={receipts} identicalReceipt={identical}")


def fi06(tmp):
    db = fresh_db(tmp)
    con = sqlite3.connect(db)
    seed_session(con)
    for i in range(50):  # committed rows still in WAL: no checkpoint, connection stays open
        send_turn(con, "s-fixture", str(uuid.uuid4()), f"m{i}")
    wal = Path(str(db) + "-wal")
    wal_size = wal.stat().st_size if wal.exists() else 0
    # copy-first while WAL is hot, then read the copy
    copy = Path(tmp) / ("copy-" + db.name)
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(db) + suffix)
        if src.exists():
            shutil.copyfile(src, Path(str(copy) + suffix))
    con.close()
    rdr = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
    count = rdr.execute("SELECT COUNT(*) FROM chat_turns").fetchone()[0]
    integrity = rdr.execute("PRAGMA integrity_check").fetchone()[0]
    rdr.close()
    ok = wal_size > 0 and count == 50 and integrity == "ok"
    return cell("FI-06", ok, f"walBytes={wal_size} copiedRows={count}/50 integrity={integrity}")


def fi08(tmp):
    db = fresh_db(tmp)
    con = sqlite3.connect(db)
    seed_session(con)
    con.execute("INSERT INTO chat_attempts VALUES('a-1','s-fixture',1,1,1,'running','b','term-crashed',1,1,?,?)", (now(), now()))
    con.commit()
    # Reclaimer fences with generation+1, conditional on the stale generation.
    cur = con.execute("UPDATE chat_attempts SET state='failed', lease_owner='term-new', lease_generation=2, version=version+1 WHERE chat_attempt_id='a-1' AND lease_generation=1")
    reclaimed = cur.rowcount == 1
    # Stale owner tries to write with the old generation: must affect 0 rows.
    cur = con.execute("UPDATE chat_attempts SET state='succeeded' WHERE chat_attempt_id='a-1' AND lease_owner='term-crashed' AND lease_generation=1")
    stale_rejected = cur.rowcount == 0
    state, gen = con.execute("SELECT state, lease_generation FROM chat_attempts WHERE chat_attempt_id='a-1'").fetchone()
    dup = con.execute("SELECT COUNT(*) FROM chat_turns WHERE session_id='s-fixture' AND turn_seq=1").fetchone()[0]
    con.close()
    ok = reclaimed and stale_rejected and state == "failed" and gen == 2 and dup == 0
    return cell("FI-08", ok, f"reclaimed={reclaimed} staleWriteRejected={stale_rejected} finalState={state} gen={gen} turnSeqConflicts={dup}")


def fi09(tmp):
    db = fresh_db(tmp)
    con1 = sqlite3.connect(db, timeout=0.1)
    con1.executescript("PRAGMA busy_timeout=100;")
    seed_session(con1)
    con1.execute("BEGIN IMMEDIATE")
    con1.execute("INSERT INTO chat_turns VALUES('t-1','s-fixture',1,'user','text','w1','a-1','c-1',?)", (now(),))
    con2 = sqlite3.connect(db, timeout=0.1)
    con2.execute("PRAGMA busy_timeout=100")
    rejected = False
    try:
        con2.execute("BEGIN IMMEDIATE")
        con2.execute("INSERT INTO chat_turns VALUES('t-2','s-fixture',1,'user','text','w2','a-2','c-2',?)", (now(),))
        con2.commit()
    except sqlite3.OperationalError:
        rejected = True
        con2.rollback()
    con1.commit()
    con1.close()
    con2.close()
    con = sqlite3.connect(db)
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    rows = con.execute("SELECT COUNT(*) FROM chat_turns").fetchone()[0]
    con.close()
    ok = rejected and rows == 1 and integrity == "ok"
    return cell("FI-09", ok, f"secondWriterRejected={rejected} committedTurns={rows} integrity={integrity}")


def main() -> int:
    out = None
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
    with tempfile.TemporaryDirectory(prefix="s03-fi-") as tmp:
        results = [fi01(tmp), fi02(tmp), fi03(tmp), fi06(tmp), fi08(tmp), fi09(tmp)]
    # FI-04/FI-05 run in the TS event runner against the real Lane 2 functions;
    # FI-07 runs via sqlite-inspect.py on the promoted DBs; FI-10 pending-lane1.
    evidence = {
        "runner": "failure-inject.py",
        "ranAt": now(),
        "sqliteVersion": sqlite3.sqlite_version,
        "cells": results,
        "externalCells": {
            "FI-04": "event-evidence-runner.ts", "FI-05": "event-evidence-runner.ts",
            "FI-07": "sqlite-inspect.py on go/internal/localdb/*.db",
            "FI-10": "pending-lane1",
        },
        "passed": sum(1 for r in results if r["status"] == "pass"),
        "failed": sum(1 for r in results if r["status"] == "fail"),
    }
    text = json.dumps(evidence, indent=2)
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if evidence["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
