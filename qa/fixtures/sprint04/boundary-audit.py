#!/usr/bin/env python3
"""Privacy + reconcile boundary audit (S04-L3-002).

Machine checks over the boundary surfaces of the ADP-05 Orca reconciliation
path and the orchestration evidence tree. Two check classes:

  static-* : required guard strings present in the boundary source files
             (read-only; Lane 1/Lane 2 files are never modified)
  secret-* : no credential-shaped strings in evidence/report/fixture trees

Usage: python boundary-audit.py [--json out.json]
Exit 0 = no failing check.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # repo root (qa/fixtures/sprint04 -> repo)

STATIC_CHECKS = [
    ("static-reconciler-orphan-only-cleanup", "go/internal/builderexec/reconciler.go",
     ["if res.State != ResourceOrphan {", "continue"],
     "cleanup phase touches orphans only; probe-error/unknown resources are never destroyed"),
    ("static-reconciler-unknown-on-probe-error", "go/internal/builderexec/reconciler.go",
     ["res.State = ResourceUnknown"],
     "a probe error marks the resource unknown, never orphan (no destructive action on uncertainty)"),
    ("static-reconciler-retain-on-cleanup-failure", "go/internal/builderexec/reconciler.go",
     ["if action.Success {", "delete(r.resources"],
     "a failed cleanup keeps the resource tracked so the next pass retries"),
    ("static-reconciler-attempt-self-clean", "go/internal/builderexec/reconciler.go",
     ["Attempts self-clean"],
     "orphan attempts get action=cleanup with no external destroy/kill call"),
    ("static-slot-client-parse-boundary", "src/lib/agentRuntime/orca-slot-client.ts",
     ["dropped at the parse boundary", "Returns null on any violation"],
     "runtime-slots wire data is fail-closed parsed; unsafe fields never reach the view"),
    ("static-slot-client-safe-text", "src/lib/agentRuntime/orca-slot-client.ts",
     ["MAX_REASON_LEN", "isSafeText", "SLOT_STATES"],
     "slot strings are length-capped, control-char stripped, state enum restricted"),
    ("static-herdr-terminal-guard", "src/app/api/herdr/terminal/route.ts",
     ["checkLocalRequest(req)", "127.0.0.1 only"],
     "the shell-spawning terminal route is origin-guarded and loopback-bound"),
    ("static-loopback-allowlist", "src/lib/goApiProxy.ts",
     ['"127.0.0.1", "localhost", "[::1]", "::1"'],
     "Go listener host restricted to loopback; other hosts disable the proxy"),
    ("static-proxy-fails-closed", "src/lib/goApiProxy.ts",
     ["if (!token) return null", "x-agentic-os-token"],
     "missing token => proxy disabled, never an unauthenticated request"),
]

SECRET_PATTERNS = [
    ("secret-sen-token", re.compile(r"SEN_API_TOKEN\s*=\s*\S+")),
    ("secret-bearer", re.compile(r"Bearer\s+[A-Za-z0-9._\-]{16,}")),
    ("secret-dispatch-cap", re.compile(r"dcap_[A-Za-z0-9]{16,}")),
    ("secret-agentic-token-header", re.compile(r"x-agentic-os-token['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9._\-]{8,}")),
    ("secret-aws-style", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("secret-private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]

SCAN_DIRS = ["plans", "qa", "docs"]
SCAN_SUFFIXES = {".md", ".json", ".jsonl", ".txt", ".log", ".py", ".ts", ".ps1", ".sh"}
EXCLUDE_DIRS = {"node_modules", ".next", ".next-qa-audit", "__pycache__"}


def run_static():
    findings = []
    for check_id, rel, needles, why in STATIC_CHECKS:
        path = ROOT / rel
        if not path.exists():
            findings.append({"id": check_id, "status": "fail", "detail": f"missing file {rel}", "why": why})
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        missing = [n for n in needles if n not in text]
        findings.append({
            "id": check_id, "status": "pass" if not missing else "fail",
            "detail": "guards present" if not missing else f"missing: {missing}", "why": why,
        })
    return findings


def run_secret_scan():
    findings = []
    hits = []
    scanned = 0
    for top in SCAN_DIRS:
        base = ROOT / top
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in SCAN_SUFFIXES:
                continue
            if EXCLUDE_DIRS & set(path.parts):
                continue
            scanned += 1
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for pat_id, rx in SECRET_PATTERNS:
                for m in rx.finditer(text):
                    hits.append({"pattern": pat_id, "file": str(path.relative_to(ROOT)),
                                 "line": text.count("\n", 0, m.start()) + 1})
    for pat_id, _ in SECRET_PATTERNS:
        pat_hits = [h for h in hits if h["pattern"] == pat_id]
        findings.append({
            "id": pat_id, "status": "pass" if not pat_hits else "fail",
            "detail": "no matches" if not pat_hits else f"{len(pat_hits)} match(es): {pat_hits[:5]}",
            "why": "evidence trees must never carry credential-shaped strings",
        })
    # sen.env must not live inside the repo
    env_hits = [str(p.relative_to(ROOT)) for p in ROOT.rglob("sen.env")
                if p.is_file() and not (EXCLUDE_DIRS & set(p.parts))]
    findings.append({
        "id": "secret-sen-env-in-repo", "status": "pass" if not env_hits else "fail",
        "detail": "absent" if not env_hits else f"found: {env_hits}",
        "why": "the shared Go token file belongs in AGENTIC_OS_HOME, never the repo",
    })
    return findings, scanned


def main() -> int:
    out = None
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
    static = run_static()
    secret, scanned = run_secret_scan()
    findings = static + secret
    report = {
        "audit": "S04-L3-002 privacy + reconcile boundary",
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "filesScannedForSecrets": scanned,
        "findings": findings,
        "passed": sum(1 for f in findings if f["status"] == "pass"),
        "failed": sum(1 for f in findings if f["status"] == "fail"),
        "scopeNote": "static checks read Lane 1/Lane 2 sources read-only; secret scan covers plans/, qa/, docs/ only",
    }
    text = json.dumps(report, indent=2)
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    passed = report["passed"]
    total = passed + report["failed"]
    print(f"S04-BA: {passed}/{total} PASS scanned={scanned}")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
