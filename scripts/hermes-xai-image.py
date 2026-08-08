#!/usr/bin/env python
"""Grok Imagine image gen via Hermes' own xAI credentials (Grok OAuth) — no openclaw.

Usage: hermes-xai-image.py <prompt> <out_path> [model]
Env:   HERMES_HOME must point at a profile dir that holds the xai-oauth token
       (e.g. ~/.hermes/profiles/julian). Run with the hermes-agent venv python.
Prints "OK <bytes> <path>" on success; anything else is an error line.
"""
import sys, os, base64

sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
from tools.xai_http import resolve_xai_http_credentials  # handles OAuth refresh

def main() -> int:
    if len(sys.argv) < 3:
        print("USAGE prompt out [model]"); return 2
    prompt, out = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "grok-imagine-image"
    creds = resolve_xai_http_credentials()
    key = str(creds.get("api_key") or "").strip()
    base = str(creds.get("base_url") or "https://api.x.ai/v1").strip().rstrip("/")
    if not key:
        print("NO_CREDS — no xAI OAuth token for this HERMES_HOME"); return 3
    import httpx
    r = httpx.post(
        f"{base}/images/generations",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "prompt": prompt, "n": 1, "response_format": "b64_json"},
        timeout=120,
    )
    if r.status_code != 200:
        print("HTTP", r.status_code, r.text[:300]); return 4
    d = r.json()["data"][0]
    raw = base64.b64decode(d["b64_json"]) if d.get("b64_json") else httpx.get(d["url"], timeout=60).content
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(raw)
    print("OK", len(raw), out); return 0

if __name__ == "__main__":
    sys.exit(main())
