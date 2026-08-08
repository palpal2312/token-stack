// Free Claude Code (fcc) proxy integration.
//
// fcc-server (https://github.com/Alishahryar1/free-claude-code) is a local
// Python proxy that speaks the Anthropic Messages API but routes traffic to
// OpenRouter / NVIDIA NIM / Kimi / etc — letting us run the Claude CLI against
// free or cheap upstream models instead of paying Anthropic per-token rates.
//
// This module:
//   1. Tells the runner what env vars to inject when spawning `claude`
//   2. Probes /health so the UI can show whether the proxy is alive
//   3. Reads ~/.fcc/.env to surface the active model + provider in the dashboard
//
// Toggle file: ~/.agentic-os/fcc.json — { "enabled": true }
// Default behaviour: enabled iff the proxy is currently listening on :8082.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { omnirouteClaudeEnv, probeOmniRoute, OMNIROUTE_FREE_MODEL } from "@/lib/omniroute";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const STATE_FILE = path.join(STATE_DIR, "fcc.json");
const FCC_ENV_FILE = path.join(HOME, ".fcc", ".env");

export const FCC_PORT = 8082;
export const FCC_BASE = `http://127.0.0.1:${FCC_PORT}`;
export const FCC_TOKEN = "freecc";

export interface FccState {
  enabled: boolean;     // user opt-in (persisted)
  reachable: boolean;   // /health probe result
  model: string | null; // active model from ~/.fcc/.env (e.g. "open_router/openrouter/owl-alpha")
  provider: string | null; // friendly provider name parsed from model
}

async function readState(): Promise<{ enabled: boolean }> {
  try {
    const txt = await readFile(STATE_FILE, "utf8");
    const j = JSON.parse(txt);
    return { enabled: j.enabled !== false };
  } catch { return { enabled: true }; } // default ON
}

export async function setEnabled(enabled: boolean): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ enabled }, null, 2));
}

// Free Claude Code now runs on OmniRoute (the fcc-server on :8082 is retired —
// its `fcc` binary isn't even installed). "Reachable" = the OmniRoute gateway
// is up on :20128.
export async function probeReachable(): Promise<boolean> {
  return probeOmniRoute();
}

async function readActiveModel(): Promise<string | null> {
  try {
    const txt = await readFile(FCC_ENV_FILE, "utf8");
    // Find MODEL="..." or MODEL=... — last non-comment occurrence wins
    let model: string | null = null;
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = /^MODEL\s*=\s*"?([^"\n]+)"?$/.exec(trimmed);
      if (m) model = m[1].trim();
    }
    return model || null;
  } catch { return null; }
}

function providerNameFromModel(model: string | null): string | null {
  if (!model) return null;
  const head = model.split("/")[0];
  const map: Record<string, string> = {
    "open_router": "OpenRouter",
    "nvidia_nim": "NVIDIA NIM",
    "deepseek": "DeepSeek",
    "kimi": "Kimi",
    "wafer": "Wafer",
    "opencode": "OpenCode Zen",
    "zai": "Z.ai",
    "lmstudio": "LM Studio",
    "llamacpp": "llama.cpp",
    "ollama": "Ollama",
  };
  return map[head] ?? head;
}

export async function getState(): Promise<FccState> {
  const [{ enabled }, reachable] = await Promise.all([readState(), probeReachable()]);
  // The spawn env (fccSpawnEnv) hard-points at OmniRoute now, so report that —
  // NOT the stale MODEL that may linger in ~/.fcc/.env from the old fcc-server.
  return { enabled, reachable, model: OMNIROUTE_FREE_MODEL, provider: "OmniRoute · free pool" };
}
// kept for reference; the old fcc-server model discovery is retired.
void readActiveModel;
void providerNameFromModel;

// Env vars the Free Claude Code agent ALWAYS uses — these point the claude
// CLI at our local fcc-server, which routes to whatever upstream is configured
// in ~/.fcc/.env (OpenRouter Owl Alpha by default in our setup).
//
// CRITICAL: setting ANTHROPIC_API_KEY here is what makes the Claude CLI use
// our proxy token instead of the OAuth credentials saved by `claude login`.
// Without this, OAuth wins and fcc-server returns 401.
export function fccSpawnEnv(): Record<string, string> {
  // Free Claude Code now points the `claude` CLI at the OmniRoute gateway, which
  // routes to 90+ free providers with auto-fallback. (Was the fcc-server on
  // :8082 — retired; its binary isn't installed.)
  return {
    ...omnirouteClaudeEnv(),
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "190000",
  };
}
