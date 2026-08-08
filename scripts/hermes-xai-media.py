#!/usr/bin/env python
"""Grok image / video / voice via Hermes' own xAI credentials (Grok OAuth) — no openclaw.

Usage: hermes-xai-media.py <image|video|voice> <prompt> <out_path> [voice_id]
Env:   HERMES_HOME must point at a profile holding the xai-oauth token.
       Run with the hermes-agent venv python.
Prints "OK <bytes> <path>" on success; any other line is the error.
"""
import sys, os, base64

sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))


def _download(url: str, out: str) -> int:
    import httpx
    raw = httpx.get(url, timeout=120).content
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(raw)
    return len(raw)


def do_image(prompt: str, out: str) -> int:
    from tools.xai_http import resolve_xai_http_credentials
    import httpx
    creds = resolve_xai_http_credentials()
    key = str(creds.get("api_key") or "").strip()
    base = str(creds.get("base_url") or "https://api.x.ai/v1").rstrip("/")
    if not key:
        print("NO_CREDS"); sys.exit(3)
    r = httpx.post(f"{base}/images/generations",
                   headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                   json={"model": "grok-imagine-image", "prompt": prompt, "n": 1, "response_format": "b64_json"},
                   timeout=120)
    if r.status_code != 200:
        print("HTTP", r.status_code, r.text[:300]); sys.exit(4)
    d = r.json()["data"][0]
    if d.get("b64_json"):
        raw = base64.b64decode(d["b64_json"])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "wb").write(raw)
        return len(raw)
    return _download(d["url"], out)


def do_video(prompt: str, out: str) -> int:
    from plugins.video_gen.xai import XAIVideoGenProvider
    res = XAIVideoGenProvider().generate(prompt=prompt, aspect_ratio="16:9") or {}
    if res.get("error") or res.get("success") is False:
        print("ERR", str(res.get("error") or res)[:300]); sys.exit(4)
    url = res.get("video_url") or res.get("public_url") or res.get("public_video_url") or res.get("temporary_url")
    if not url and isinstance(res.get("video"), dict):
        url = res["video"].get("url")
    if not url and isinstance(res.get("data"), list) and res["data"]:
        url = res["data"][0].get("url")
    if not url:
        print("NOURL", ",".join(sorted(res.keys()))[:200]); sys.exit(5)
    return _download(url, out)


def do_voice(prompt: str, out: str, voice: str) -> int:
    from tools.tts_tool import _generate_xai_tts
    _generate_xai_tts(prompt, out, {"xai": {"voice_id": voice}})
    return os.path.getsize(out) if os.path.exists(out) else 0


def main() -> int:
    if len(sys.argv) < 4:
        print("USAGE kind prompt out [voice]"); return 2
    kind, prompt, out = sys.argv[1], sys.argv[2], sys.argv[3]
    voice = sys.argv[4] if len(sys.argv) > 4 else "eve"
    n = {"image": lambda: do_image(prompt, out),
         "video": lambda: do_video(prompt, out),
         "voice": lambda: do_voice(prompt, out, voice)}.get(kind)
    if not n:
        print("BAD_KIND", kind); return 2
    b = n()
    if not b or not os.path.exists(out):
        print("NO_OUTPUT"); return 6
    print("OK", b, out); return 0


if __name__ == "__main__":
    sys.exit(main())
