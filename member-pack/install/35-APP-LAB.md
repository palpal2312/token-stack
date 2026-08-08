# 35 · App Lab — Ready-Made AI Apps, Free (Optional)

The **App Lab** tab is a small catalog of ready-to-run AI apps — adapted from the popular [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) collection to run entirely on **free cloud models** (no local models, no paid keys beyond one OpenRouter key). Click an app, it starts, and you use it right there in an embedded window.

What's in the box:
- **Free Mixture-of-Agents** — four free models answer in parallel, a fifth blends the best of all four.
- **Chat with any Webpage** — paste a URL, ask questions about the page.
- **AI Travel Planner** — destination + days → a day-by-day itinerary with a downloadable calendar (.ics).

## Setup (2 steps)
1. **Get a free OpenRouter key.** The apps read it from your Hermes profile — see `4-HERMES.md` for that one-time key setup (the same key powers the free models across the OS).
2. **Clone the apps repo** (one time):
   ```bash
   git clone https://github.com/Shubhamsaboo/awesome-llm-apps ~/Developer/awesome-llm-apps
   ```
   Open the **App Lab** tab, click an app, and it installs its own dependencies the first time, then runs.

> 🟢 Easiest: open any AI agent in the folder and say *"set up App Lab for me."*

## Good to know
- **Free to run** — every app rides OpenRouter's `:free` models, so there's no per-use cost.
- **Free models throttle** — if an app is slow or errors, that's the free tier rate-limiting; wait a moment and retry.
- **Local + private** — each app runs on your Mac; only your prompts go to the free model.
- Add your own: the catalog lives in the app's code — any AI agent in the folder can wire in another `awesome-llm-apps` app for you.
