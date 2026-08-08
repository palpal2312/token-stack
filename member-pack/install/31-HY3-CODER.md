# 31 · Hy3 Coder — Cheap, Fast One-Shot Builds (Optional)

The **Hy3 Coder** tab builds things fast with **Tencent Hy3** (Hunyuan 3, Apache-2.0) — a strong open-weights coding model. It's great for **one-shot builds**: describe what you want, watch it stream a complete single-file build on the right, and grab the result.

It runs through **OpenRouter**, so it's cheap pay-as-you-go (a few cents a build), not a subscription.

## What you need
- **An OpenRouter key** — the same one the other AI tabs use (`OPENROUTER_API_KEY`, read from your environment or `~/.hermes`). No new account.
  - Don't have one? Get it at <https://openrouter.ai/keys>.

## How to use it
1. Open the **Hy3 Coder** tab (left sidebar, under the agents).
2. Type what you want built (e.g. *"a landing page for a coffee subscription, dark theme, one file"*).
3. It streams the build live and shows a preview. Copy or download the result.

## Good to know
- **Cheap, not free** — OpenRouter bills your account per build (usually a few cents). Nothing is charged by Agent OS.
- **It can be slow** — the upstream often takes 60–180s to finish; the tab streams so you see progress, not a frozen screen.
- **Best for one-shot builds** — a whole small page/app in one go. For long multi-step work use Claude / Free Claude Code; for $0 builds use **OmniRoute** (`28-OMNIROUTE.md`) or the local model.
