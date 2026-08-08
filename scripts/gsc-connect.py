#!/usr/bin/env python3
"""Connect YOUR Google Search Console to the Agent OS SEO → Research tab (read-only).

Run this ONCE. It opens a browser, you approve read-only access to your own Search
Console, and it caches a token so the Research tab can pull your keyword data. It
never sees a password and only ever reads (never changes) your Search Console.

ONE-TIME SETUP (5 min) — get your own free Google OAuth client:
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Enable the "Google Search Console API" for the project.
  3. Create Credentials → OAuth client ID → Application type: "Desktop app".
  4. Download the JSON and save it as:
         ~/.agentic-os/gsc-oauth-client.json
  5. Run this script:
         python3 scripts/gsc-connect.py
     A browser opens — approve, and you're connected. The Research tab lights up.

Re-run any time to refresh the list of your verified sites.

Files (all under ~/.agentic-os/, created for you):
  gsc-oauth-client.json  <- you download this (step 4 above)
  gsc-token.json         <- your cached read-only token (auto-created; keep private)
  gsc-latest.json        <- your verified properties, so the tab knows your sites
"""
import sys, json
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

AOS = Path.home() / ".agentic-os"
AOS.mkdir(parents=True, exist_ok=True)
CLIENT = AOS / "gsc-oauth-client.json"
TOKEN = AOS / "gsc-token.json"
LATEST = AOS / "gsc-latest.json"
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

# Optional: pass site domains as args to pre-filter; default = ALL your verified
# properties (this is YOUR account — never a hardcoded list).
SITES = sys.argv[1:]


def creds():
    c = None
    if TOKEN.exists():
        c = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not c or not c.valid:
        if c and c.expired and c.refresh_token:
            try:
                c.refresh(Request())
            except Exception:
                c = None
        if not c:
            if not CLIENT.exists():
                sys.exit(
                    f"\nERROR: OAuth client not found at {CLIENT}\n"
                    "→ Follow the ONE-TIME SETUP at the top of this file (create a free\n"
                    "  Google 'Desktop app' OAuth client, download the JSON, save it there),\n"
                    "  then run this again.\n")
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT), SCOPES)
            c = flow.run_local_server(
                port=0, prompt="consent",
                authorization_prompt_message="Opening a browser to authorize Search Console (read-only)…")
        TOKEN.write_text(c.to_json())
        TOKEN.chmod(0o600)
    return c


def variants(domain):
    return [f"sc-domain:{domain}", f"https://{domain}/", f"https://www.{domain}/"]


def main():
    s = build("searchconsole", "v1", credentials=creds(), cache_discovery=False)
    entries = s.sites().list().execute().get("siteEntry", [])
    verified = {x["siteUrl"] for x in entries
                if x.get("permissionLevel") != "siteUnverifiedUser"}
    if not verified:
        sys.exit("Connected, but this Google account has no verified Search Console "
                 "properties. Add + verify a site at https://search.google.com/search-console")

    # Which domains to record: the ones you passed, or every verified property.
    if SITES:
        domains = [d.replace("https://", "").replace("http://", "").replace("www.", "").strip("/").lower()
                   for d in SITES]
    else:
        domains = sorted({u.replace("sc-domain:", "").replace("https://", "")
                          .replace("http://", "").replace("www.", "").strip("/").lower()
                          for u in verified})

    # Write gsc-latest.json keyed by domain so the Research tab lists YOUR sites.
    latest = {}
    for d in domains:
        if any(v in verified for v in variants(d)):
            latest[d] = {}
    if not latest:
        sys.exit("None of the sites given match your verified properties. Your verified "
                 f"properties are:\n  " + "\n  ".join(sorted(verified)))
    LATEST.write_text(json.dumps(latest, indent=2))

    print(f"\n✓ Connected. {len(latest)} site(s) ready in the Research tab:")
    for d in sorted(latest):
        print(f"    • {d}")
    print("\nOpen Agent OS → SEO → Research and pick a site. You're done.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"{type(e).__name__}: {str(e)[:200]}")
