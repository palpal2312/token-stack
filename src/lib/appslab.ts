// App Lab — run apps from Shubhamsaboo/awesome-llm-apps inside the Agent OS.
// Catalog entries are the apps we've adapted to run WITHOUT local models:
// everything rides OpenRouter :free cloud models (cloud-only by design: no Ollama).
// Repo cloned at ~/Developer/awesome-llm-apps; each app runs as a detached
// Streamlit server on its own port, previewed in an iframe (?embed=true).

import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hermesHome } from "@/lib/config";

export const APPS_REPO = path.join(os.homedir(), "Developer", "awesome-llm-apps");
export const APPLAB_STATE = path.join(os.homedir(), ".agentic-os", "app-lab");

const BIN_PATH = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  process.env.PATH || "",
].filter(Boolean).join(":");

export interface LabApp {
  slug: string;
  title: string;
  desc: string;
  dir: string;    // relative to APPS_REPO
  file: string;   // streamlit entry file
  port: number;
  model: string;  // which free model powers it
  adapted: boolean; // true = our free-cloud variant of a repo app
}

export const CATALOG: LabApp[] = [
  {
    slug: "free-moa",
    title: "Free Mixture-of-Agents",
    desc: "Four free models answer in parallel, a fifth synthesizes the best of all four. The repo's MoA app, moved from paid Together AI to OpenRouter :free.",
    dir: "starter_ai_agents/mixture_of_agents",
    file: "free_mixture_of_agents.py",
    port: 8512,
    model: "hy3 + llama-3.3-70b + qwen3-80b + hermes-405b → nemotron-550b",
    adapted: true,
  },
  {
    slug: "web-chat",
    title: "Chat with any Webpage",
    desc: "Paste a URL, ask questions about the page. The repo's local-RAG tutorial rebuilt for a free 70B cloud model — no vector store, no local anything.",
    dir: "rag_tutorials/llama3.1_local_rag",
    file: "free_web_chat.py",
    port: 8511,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    adapted: true,
  },
  {
    slug: "travel-planner",
    title: "AI Travel Planner",
    desc: "Destination + days → a day-by-day itinerary with a downloadable calendar (.ics). The repo's travel agent on a free 80B planner.",
    dir: "starter_ai_agents/ai_travel_agent",
    file: "free_travel_agent.py",
    port: 8513,
    model: "qwen/qwen3-next-80b-a3b-instruct:free",
    adapted: true,
  },
];

export function appBySlug(slug: string): LabApp | undefined {
  return CATALOG.find((a) => a.slug === slug);
}

// OpenRouter key lives in the Hermes north-mini profile .env — read it
// server-side at spawn time; never copied anywhere else.
export function openrouterKey(): string {
  try {
    const env = readFileSync(path.join(hermesHome(), "profiles", "north-mini", ".env"), "utf8");
    const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

function pidFile(slug: string): string { return path.join(APPLAB_STATE, `${slug}.pid`); }

export function appRunning(slug: string): boolean {
  const f = pidFile(slug);
  if (!existsSync(f)) return false;
  const pid = parseInt(readFileSync(f, "utf8").trim(), 10);
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function startApp(app: LabApp): Promise<number> {
  await mkdir(path.join(APPLAB_STATE, "logs"), { recursive: true });
  const cwd = path.join(APPS_REPO, app.dir);
  const venvPy = path.join(cwd, ".venv", "bin", "python");
  const logFd = openSync(path.join(APPLAB_STATE, "logs", `${app.slug}.log`), "a");
  const child = spawn(venvPy, [
    "-m", "streamlit", "run", app.file,
    "--server.port", String(app.port),
    "--server.headless", "true",
    "--server.enableCORS", "false",
    "--server.enableXsrfProtection", "false",
  ], {
    cwd,
    env: { ...process.env, PATH: BIN_PATH, OPENROUTER_API_KEY: openrouterKey() },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  return child.pid ?? -1;
}

export function stopApp(slug: string): boolean {
  const f = pidFile(slug);
  if (!existsSync(f)) return false;
  const pid = parseInt(readFileSync(f, "utf8").trim(), 10);
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { return false; } }
  return true;
}

export { pidFile };
