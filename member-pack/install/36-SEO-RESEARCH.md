# 36 · SEO → Research — Connect Your Own Search Console (Optional)

The **SEO → Research** tab pulls **live, read-only** keyword data from **your own** Google Search Console — the searches you already rank for — and scores them into ranked opportunities (CTR leaks, striking-distance keywords, content gaps). It's the fastest way to find "what should I write next?".

It reads **your** Search Console. It never changes anything, and no password ever leaves your machine — you approve read-only access in your own Google account.

> 🟢 **Easiest:** open any AI agent in the Agent OS folder and say *"connect my Google Search Console for the SEO Research tab, walk me through it."* It'll do the steps below with you.

## One-time setup (about 5 minutes)

You need a free Google "OAuth client" — this is what lets the tab read your Search Console on your behalf.

1. **Open** <https://console.cloud.google.com/apis/credentials> (sign in with the Google account that owns your Search Console).
2. **Enable the API:** search for **"Google Search Console API"** and click **Enable**.
3. **Create the client:** **Create Credentials → OAuth client ID → Application type: Desktop app → Create**.
4. **Download** the JSON it gives you, and save it as exactly:
   ```
   ~/.agentic-os/gsc-oauth-client.json
   ```
5. **Connect** — in the Agent OS folder, run:
   ```bash
   python3 scripts/gsc-connect.py
   ```
   A browser opens → approve read-only access. When it prints **"✓ Connected"** with your sites, you're done. 🎉

Open **SEO → Research**, pick a site (or "All sites"), and hit research.

## Good to know
- **Read-only + private** — the tool can only *read* Search Console; it never edits your site or account. The token is cached at `~/.agentic-os/gsc-token.json` (keep it private).
- **Your sites, not anyone else's** — the site list comes from *your* verified properties. If a site's missing, verify it first at <https://search.google.com/search-console>.
- **Refresh any time** — re-run `python3 scripts/gsc-connect.py` to update your site list or renew access.
- **Optional richer competitor data** — set a `SERPAPI_KEY` (env var) to layer in competitor SERP data. Not required.
- **Needs Python + Google libs.** If `gsc-connect.py` complains about a missing module, install them once:
  ```bash
  /usr/bin/python3 -m pip install --user google-api-python-client google-auth-oauthlib
  ```
