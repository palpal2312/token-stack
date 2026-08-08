# 33 · Video Editor — Edit Any Video by Chatting (Optional)

> 🛑 **This is already built into your dashboard — don't build it, and don't let your AI build it.** It's the **Video Editor** tab (left sidebar). If you don't see it, your pack is out of date — download the newest Agent OS pack (check `build <date>` under the "Agentic OS" logo).

The **Video Editor** tab edits a video by conversation. Upload a clip, describe what you want in plain English — *"cut the dead air, add subtitles, punch up the colour"* — and it produces a finished `final.mp4`. No timeline, no menus.

It's powered by the **video-use** skill running through your coding agent.

## What you need
- **A coding agent** — Claude Code, or the GLM Code runner (`27-GLM-CODE.md`) — that's what drives the edits.
- **The `video-use` skill** installed for that agent (it lives with your Claude Code skills).
- **ffmpeg** — the free tool that does the actual cutting/encoding: `brew install ffmpeg` (Mac) / `winget install ffmpeg` (Windows).

> 🟢 Easiest: open the tab, and if it says something's missing, ask your agent *"set up the Video Editor — check the video-use skill and ffmpeg are installed."*

## How to use it
1. Open the **Video Editor** tab.
2. **Upload** your video.
3. **Describe the edit** you want (cuts, subtitles, overlays, colour, music).
4. It works through the plan and gives you the finished `final.mp4` to download.

## Good to know
- **Runs on your Mac** — your video stays local; ffmpeg does the work here.
- **Best for talking-heads, montages, tutorials** — describe the change, iterate by chatting.
- If a render fails, tell the agent what looked wrong — it fixes and re-renders.
