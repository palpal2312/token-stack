#!/usr/bin/env python3
"""Per-site keyword research from Google Search Console (read-only).

Pulls live GSC query + page data for ONE site, scores each query into a
prioritized opportunity (CTR leak / striking distance / content gap / high
impressions), and prints a single JSON object on stdout for the Agent OS
SEO Content Pipeline "Research" tab.

Usage:  gsc-research.py <site-domain> [days] [seed words...]
Auth:   reuses the cached OAuth token at ~/.agentic-os/gsc-token.json
        (same read-only token the keyword-research skill uses).
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

AOS = Path.home() / ".agentic-os"
TOKEN = AOS / "gsc-token.json"
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def die(msg):
    print(json.dumps({"error": msg}))
    sys.exit(0)


def creds():
    if not TOKEN.exists():
        die("No GSC token. Run: python3 ~/.agentic-os/gsc-report.py  (authorizes once)")
    c = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not c.valid:
        if c.expired and c.refresh_token:
            c.refresh(Request())
            TOKEN.write_text(c.to_json()); TOKEN.chmod(0o600)
        else:
            die("GSC token expired. Run: python3 ~/.agentic-os/gsc-report.py  to re-auth")
    return c


# Rough industry CTR-by-position curve — used to size the click opportunity.
_CTR = {1: 0.28, 2: 0.16, 3: 0.11, 4: 0.08, 5: 0.06,
        6: 0.05, 7: 0.04, 8: 0.032, 9: 0.028, 10: 0.025}


def expected_ctr(pos):
    p = max(1, int(round(pos)))
    if p <= 10:
        return _CTR[p]
    return 0.015 if p <= 20 else 0.008


def variants(domain):
    return [f"sc-domain:{domain}", f"https://{domain}/", f"https://www.{domain}/"]


def gsc_query(svc, site_url, dims, days, row_limit=5000):
    end = date.today() - timedelta(days=2)          # GSC lags ~2 days
    start = end - timedelta(days=days)
    body = {"startDate": start.isoformat(), "endDate": end.isoformat(),
            "dimensions": dims, "rowLimit": row_limit}
    rows = svc.searchanalytics().query(siteUrl=site_url, body=body).execute().get("rows", [])
    return rows, start, end


def reason(badge, pos, impr, ctr, exp):
    if badge == "LOW CTR":
        return f"Page 1 (#{pos:.1f}) but CTR {ctr*100:.1f}% vs ~{exp*100:.0f}% expected — refresh the title + meta"
    if badge == "STRIKING DISTANCE":
        return f"Ranking #{pos:.1f} with {impr:,} impressions — a push gets it to page 1"
    if badge == "CONTENT GAP":
        return f"#{pos:.1f}, {impr:,} impressions, 0 clicks — content gap, one post can capture it"
    return f"{impr:,} impressions at #{pos:.1f} — high-volume opportunity worth targeting"


def main():
    if len(sys.argv) < 2:
        die("usage: gsc-research.py <site> [days] [seed]")
    domain = sys.argv[1].replace("https://", "").replace("http://", "").replace("www.", "").strip("/").lower()
    days = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 28
    seed = " ".join(sys.argv[3:]).strip().lower()
    seed_words = [w for w in seed.split() if len(w) >= 3]

    svc = build("searchconsole", "v1", credentials=creds(), cache_discovery=False)
    verified = {s["siteUrl"] for s in svc.sites().list().execute().get("siteEntry", [])
                if s.get("permissionLevel") != "siteUnverifiedUser"}
    site_url = next((v for v in variants(domain) if v in verified), None)
    if not site_url:
        die(f"{domain} is not one of your verified GSC properties")

    q_rows, start, end = gsc_query(svc, site_url, ["query"], days)
    qp_rows, _, _ = gsc_query(svc, site_url, ["query", "page"], days)

    best_page = {}
    for r in qp_rows:
        q, pg = r["keys"][0], r["keys"][1]
        if q not in best_page or r["impressions"] > best_page[q][1]:
            best_page[q] = (pg, r["impressions"])

    total_impr = sum(r["impressions"] for r in q_rows)
    total_clicks = sum(r["clicks"] for r in q_rows)

    topics = []
    for r in q_rows:
        kw, impr, clk, ctr, pos = r["keys"][0], r["impressions"], r["clicks"], r["ctr"], r["position"]
        if impr < 20:
            continue
        exp = expected_ctr(pos)
        target = expected_ctr(pos) if pos <= 3 else expected_ctr(3)   # aspire to top-3 CTR
        opp = impr * max(target - ctr, 0)                              # clicks left on the table

        badges = []
        leak = pos <= 10.5 and impr >= 80 and ctr < 0.015
        striking = 4.5 <= pos <= 20.5 and impr >= 30
        gap = 5 <= pos <= 12 and clk == 0 and impr >= 60
        high = impr >= 300
        if leak:
            badges.append("LOW CTR")
        if striking and not leak:
            badges.append("STRIKING DISTANCE")
        if gap and "CONTENT GAP" not in badges:
            badges.append("CONTENT GAP")
        if high and not badges:
            badges.append("HIGH IMPRESSIONS")
        if not badges:
            continue

        topics.append({
            "keyword": kw,
            "score": round(opp * 60 + impr * 0.5),
            "badges": badges,
            "impressions": impr,
            "clicks": clk,
            "ctr": round(ctr, 4),
            "position": round(pos, 1),
            "page": best_page.get(kw, ("", 0))[0],
            "reason": reason(badges[0], pos, impr, ctr, exp),
        })

    if seed_words:
        filtered = [t for t in topics if any(w in t["keyword"] for w in seed_words)]
        if len(filtered) >= 3:
            topics = filtered

    topics.sort(key=lambda t: t["score"], reverse=True)
    print(json.dumps({
        "site": domain,
        "property": site_url,
        "days": days,
        "window": [start.isoformat(), end.isoformat()],
        "totalQueries": len(q_rows),
        "totalImpressions": total_impr,
        "totalClicks": total_clicks,
        "topics": topics[:25],
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        die(f"{type(e).__name__}: {str(e)[:200]}")
