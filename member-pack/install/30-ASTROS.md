# 30 · Hermes Astros — Your 24/7 YouTube Watcher (Optional)

> 🛑 **Astros is ALREADY built into your dashboard — do NOT build it, and don't let your AI build it.** It's the slick "starchart" tab you saw in the video. If you (or Claude/Codex) start creating a YouTube-search feature from scratch, stop — that's the wrong thing. **If you don't see it, your pack is out of date: download the newest Agent OS pack** (check the `build <date>` under the "Agentic OS" logo, top-left) and it'll be there. This page just turns it on and, optionally, adds a key.

**Hermes Astros** is the YouTube sibling of The Radar (which watches X). It's a sub-tab inside the **Hermes** section — open the **Hermes** tab, then click **Hermes Astros**.

It watches the newest uploads from the channels in your niche and hands you **trending video ideas**, a ready-to-use **YouTube title** for each, the **SEO keyword**, and a content angle — so you always know what to make next.

## It works with zero setup
Astros has three quality tiers and **falls back to the free one automatically**, so it works the moment you open it — no key needed:
1. **Keyless (default)** — reads channel RSS feeds + scrapes YouTube search. Free, no setup.
2. **YouTube API key** — set `YT_API_KEY` for cleaner data + higher limits.
3. **Google sign-in (best)** — a YouTube OAuth token gives the richest data.

Start with keyless. Add a key only if you want more.

## Setup (optional, for better data)
In the **Hermes → Hermes Astros** tab, add the channels + keywords you want watched. To upgrade the data source:
- **API key:** get a free YouTube Data API key (Google Cloud console), then set it as `YT_API_KEY`.
- **Google OAuth (richest):** run the one-time auth helper `~/.agentic-os/astros-youtube-auth.py` to mint a `youtube.readonly` token.

> 🟢 Easiest: open any AI agent in the folder and say *"set up Hermes Astros — add my YouTube channels to watch, and help me connect a YouTube API key if I have one."*

## How to use it
1. **Hermes → Hermes Astros.**
2. Add the channels/keywords in your niche.
3. Hit scan → you get fresh video ideas with titles + SEO keywords, ready to feed your content pipeline (or the SEO tab).

## Good to know
- **No key required** — the keyless tier works day one; keys just improve the data.
- **Pairs with The Radar** (`23-RADAR.md`, watches X) — Astros watches YouTube. Between them you never run out of what to post.
