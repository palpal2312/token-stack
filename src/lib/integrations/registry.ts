// Open-source tools Agent OS builds on.
//
// The point of this registry is a repeatable shape — detect, health, install
// hint, and which space uses it — so adding the next OSS project is filling in
// an entry rather than writing another one-off status widget.
//
// Two rules keep it honest:
//
//   1. Nothing here installs or updates anything. `installHint` is text with a
//      copy button; the user runs it in their own terminal. These are other
//      people's programs, some of them beta, and a dashboard that silently
//      installs software is a dashboard you cannot trust.
//   2. Detection delegates to whatever already resolves the tool. Some are
//      binaries found through config.ts, one lives at a fixed path of its own,
//      and one is an HTTP daemon with no binary to find. Re-deriving any of
//      that here would mean the Integrations page and the space that actually
//      uses the tool could disagree about whether it is installed.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config";
import { herdrStatus } from "../herdr";
import { OPENCODE_BIN } from "../opencode";
import { listRouters, routerKind } from "../routers/registry";

export type Category = "terminal" | "cli-agent" | "mcp" | "runtime" | "gateway";

export interface Detection {
  installed: boolean;
  /**
   * Something answered, but the check cannot prove it is *this* program.
   *
   * A separate flag rather than a false `installed`, because both of the simple
   * answers are wrong: "not found" contradicts a live endpoint, and a plain
   * "found" claims an identity a port probe cannot establish — and hides the
   * install command from someone who may well still need it.
   */
  probable?: boolean;
  path?: string;
  version?: string;
  /** Why it was not found, in plain language. */
  detail?: string;
}

export interface Health {
  ok: boolean;
  detail: string;
}

export interface Integration {
  id: string;
  name: string;
  repo: string;
  license: string;
  category: Category;
  /** The version Agent OS was actually tested against, when one was pinned. */
  pinnedVersion?: string;
  detect: () => Promise<Detection>;
  health?: () => Promise<Health>;
  /** Shown with a copy button. Never executed by Agent OS. */
  installHint: { command: string; url: string };
  /** Routes that stop working without it. */
  usedBy: string[];
  notes: string;
}

/** A binary the shared config already resolves. */
function binDetect(bin: string | null, name: string): Detection {
  if (!bin) return { installed: false, detail: `No ${name} binary on PATH or in the Agent OS config.` };
  if (!existsSync(bin)) return { installed: false, path: bin, detail: `Configured at ${bin}, but nothing is there.` };
  return { installed: true, path: bin };
}

/** An HTTP daemon: there is no file to look for, only an answer or silence. */
async function endpointDetect(url: string, name: string, timeoutMs = 2_500): Promise<Detection> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return { installed: false, detail: `${name} answered ${r.status} at ${url}.` };
    const text = (await r.text()).trim();
    return { installed: true, path: url, version: text.slice(0, 60) || undefined };
  } catch {
    return { installed: false, detail: `Nothing is answering at ${url}. ${name} is either not installed or not running.` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A gateway the user configured as a Router.
 *
 * Detection follows the Router the user actually made rather than a hard-coded
 * port, because a self-hosted gateway can live anywhere.
 *
 * The important limit is stated rather than papered over: an HTTP port does not
 * say what software is behind it. This can tell whether *an OpenAI-compatible
 * endpoint* is answering — a model list, or a 401 asking for a key — and it says
 * so in those words. It never claims a particular project is installed, because
 * any number of local gateways answer the same way on the same port.
 */
async function gatewayDetect(kindId: string, fallbackUrl: string, name: string): Promise<Detection> {
  let baseUrl = fallbackUrl;
  let routerName: string | null = null;
  try {
    const rs = (await listRouters()).filter((r) => r.kind === kindId);
    const chosen = rs.find((r) => r.isDefault) ?? rs[0];
    if (chosen) { baseUrl = chosen.baseUrl; routerName = chosen.name; }
  } catch { /* a corrupt Router file is that page's problem, not this one's */ }

  const where = routerName ? `${baseUrl} (the "${routerName}" Router)` : baseUrl;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2_500);
  try {
    const r = await fetch(`${baseUrl}/models`, { signal: ctl.signal, cache: "no-store" });

    if (r.status === 401 || r.status === 403) {
      return {
        installed: true,
        probable: true,
        path: baseUrl,
        version: "an endpoint asking for a key",
        detail: `Something at ${where} answered ${r.status} and asked for a key. That is what a running `
          + `${name} looks like, but any OpenAI-compatible gateway answers the same way — Agent OS cannot `
          + `confirm which software it is.`,
      };
    }
    if (r.ok) {
      const body = await r.json().catch(() => null) as { data?: unknown; models?: unknown } | null;
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
      if (list) {
        return {
          installed: true,
          probable: true,
          path: baseUrl,
          version: `${list.length} model${list.length === 1 ? "" : "s"} listed`,
          detail: `An OpenAI-compatible endpoint is answering at ${where}. Agent OS cannot confirm it is `
            + `${name} rather than another gateway on the same port.`,
        };
      }
    }
    return {
      installed: false,
      detail: `Something is answering at ${where}, but not as an OpenAI-compatible model endpoint `
        + `(HTTP ${r.status}). That is likely a different program on that port.`,
    };
  } catch {
    return {
      installed: false,
      detail: routerName
        ? `Nothing is answering at ${where}.`
        : `Nothing is answering at ${baseUrl}. Add a Router in Router Config once it is running.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const INTEGRATIONS: Integration[] = [
  {
    id: "herdr",
    name: "Herdr",
    repo: "https://github.com/ogulcancelik/herdr",
    license: "MIT",
    category: "terminal",
    // 0.7.4-preview is what the Code Space was built and verified against. Its
    // CLI reports errors in two different JSON shapes; lib/herdr.ts handles both.
    pinnedVersion: "0.7.4-preview",
    detect: async () => {
      const s = await herdrStatus();
      return s.installed
        ? { installed: true, path: s.bin ?? undefined, version: s.version ?? undefined }
        : { installed: false, detail: s.error ?? "Not installed." };
    },
    health: async () => {
      const s = await herdrStatus();
      // "Installed but the server is down" and "not installed" are different
      // problems with different fixes, so they never collapse into one message.
      if (!s.installed) return { ok: false, detail: s.error ?? "Herdr is not installed." };
      if (!s.running) return { ok: false, detail: s.error ?? "Installed, but its server is not answering. Run `herdr` in a terminal." };
      return { ok: true, detail: `Server answering${s.version ? ` · ${s.version}` : ""}.` };
    },
    installHint: {
      command: "npm install -g herdr",
      url: "https://github.com/ogulcancelik/herdr#installation",
    },
    usedBy: ["/code-space"],
    notes: "Persistent terminal panes for coding agents. Beta on Windows — expect rough edges.",
  },
  {
    id: "opencode",
    name: "opencode",
    repo: "https://github.com/sst/opencode",
    license: "MIT",
    category: "cli-agent",
    // Not a config.ts key: it resolves itself in lib/opencode.ts, so this
    // delegates there rather than guessing a second path.
    detect: async () => binDetect(OPENCODE_BIN, "opencode"),
    installHint: {
      command: "curl -fsSL https://opencode.ai/install | bash",
      url: "https://opencode.ai/docs",
    },
    usedBy: ["/opencode", "/agents/new"],
    notes: "Terminal coding agent. Also available as an Agent Skin.",
  },
  {
    id: "ruflo",
    name: "Ruflo",
    repo: "https://github.com/ruvnet/ruflo",
    license: "MIT",
    category: "cli-agent",
    detect: async () => binDetect(config.ruflo, "ruflo"),
    installHint: {
      command: "npm install -g ruflo",
      url: "https://github.com/ruvnet/ruflo#readme",
    },
    usedBy: ["/ruflo"],
    notes: "Multi-agent swarm orchestration. Powers the Swarm tab.",
  },
  {
    id: "notebooklm-mcp",
    name: "NotebookLM MCP",
    repo: "https://github.com/PleasePrompto/notebooklm-mcp",
    license: "MIT",
    category: "mcp",
    detect: async () => binDetect(config.nlmBin, "notebooklm-mcp"),
    installHint: {
      command: "npm install -g notebooklm-mcp",
      url: "https://github.com/PleasePrompto/notebooklm-mcp#readme",
    },
    usedBy: ["/notebook"],
    notes: "MCP server bridging NotebookLM. The Notebook space drives it.",
  },
  {
    id: "ollama",
    name: "Ollama",
    repo: "https://github.com/ollama/ollama",
    license: "MIT",
    category: "runtime",
    // A daemon, not a binary probe: what matters is whether it answers.
    detect: async () => endpointDetect("http://127.0.0.1:11434/api/version", "Ollama"),
    health: async () => {
      const d = await endpointDetect("http://127.0.0.1:11434/api/tags", "Ollama", 4_000);
      return d.installed
        ? { ok: true, detail: "Daemon answering on :11434." }
        : { ok: false, detail: d.detail ?? "Not answering on :11434." };
    },
    installHint: {
      command: "winget install Ollama.Ollama",
      url: "https://ollama.com/download",
    },
    usedBy: ["/local", "/glm-code"],
    notes: "Local model runtime on :11434. The Local tab and GLM Code both read it.",
  },
  {
    id: "firstmate",
    name: "Sen",
    repo: "https://github.com/kunchenguid/firstmate",
    license: "MIT",
    category: "cli-agent",
    // An agent distro, not a binary: detection is the clone itself. FM_HOME wins
    // because a secondmate home is still a firstmate install.
    detect: async () => {
      const home = process.env.FM_HOME || path.join(os.homedir(), "firstmate");
      return existsSync(path.join(home, "AGENTS.md")) && existsSync(path.join(home, "bin", "fm-spawn.sh"))
        ? { installed: true, path: home }
        : { installed: false, detail: `No firstmate clone at ${home} (AGENTS.md + bin/fm-spawn.sh not found).` };
    },
    installHint: {
      command: "git clone https://github.com/kunchenguid/firstmate && cd firstmate && claude",
      url: "https://github.com/kunchenguid/firstmate#quick-start",
    },
    usedBy: ["/code-space"],
    notes: "Agent distro — one orchestrator runs a crew of coding agents. Crew panes live in the `firstmate` "
      + "Herdr workspace (visible in Code Space); each crewmate runs under an Agent OS Builder profile via the "
      + "herdr-crew skill. The primary session is a terminal harness (`claude` inside the clone), not a dashboard tab.",
  },
  {
    id: "sub2api",
    name: "Sub2API",
    repo: "https://github.com/Wei-Shaw/sub2api",
    license: "LGPL-3.0",
    category: "gateway",
    // v0.1.165 is the release whose asset list and API surface this entry was
    // written against; it ships a windows_amd64 binary alongside the Docker path.
    pinnedVersion: "v0.1.165",
    detect: async () => gatewayDetect(
      "sub2api",
      routerKind("sub2api")?.defaultBaseUrl ?? "http://127.0.0.1:8080/v1",
      "Sub2API",
    ),
    installHint: {
      // Not a one-liner on purpose: Sub2API needs PostgreSQL 15+ and Redis 7+, so
      // the honest instruction is its compose file, not an npm install.
      command: "docker compose up -d   # needs PostgreSQL 15+ and Redis 7+",
      url: "https://github.com/Wei-Shaw/sub2api#deployment",
    },
    usedBy: ["/routers"],
    notes: "Self-hosted gateway that re-exposes AI subscriptions as an OpenAI-compatible API. "
      + "Agent OS only ever talks to the endpoint you point a Router at — it never installs or runs it. "
      + "Its own README warns that using it may breach the upstream providers' terms of service; that is your call to make.",
  },
];

export function allIntegrations(): Integration[] { return INTEGRATIONS; }
export function integration(id: string): Integration | null {
  return INTEGRATIONS.find((i) => i.id === id) ?? null;
}

export interface IntegrationStatus {
  id: string; name: string; repo: string; license: string; category: Category;
  pinnedVersion: string | null;
  installed: boolean;
  probable: boolean;
  path: string | null;
  version: string | null;
  detail: string | null;
  hasHealth: boolean;
  installHint: { command: string; url: string };
  usedBy: string[];
  notes: string;
}

/**
 * Probe everything at once. A tool that hangs must not hold up the others, so
 * each probe is independent and a thrown one becomes a reported failure rather
 * than an empty page.
 */
export async function statusAll(): Promise<IntegrationStatus[]> {
  return Promise.all(INTEGRATIONS.map(async (i): Promise<IntegrationStatus> => {
    let d: Detection;
    try { d = await i.detect(); }
    catch (e) { d = { installed: false, detail: `Could not check: ${String((e as Error)?.message ?? e)}` }; }
    return {
      id: i.id, name: i.name, repo: i.repo, license: i.license, category: i.category,
      pinnedVersion: i.pinnedVersion ?? null,
      installed: d.installed,
      probable: Boolean(d.probable),
      path: d.path ?? null,
      version: d.version ?? null,
      detail: d.detail ?? null,
      hasHealth: Boolean(i.health),
      installHint: i.installHint,
      usedBy: i.usedBy,
      notes: i.notes,
    };
  }));
}
