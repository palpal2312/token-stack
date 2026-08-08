// Agent Skins — the reusable half of an agent.
//
// Every tab that used to sit under "Agents" is a skin: a UI and a set of
// expectations about what its backend can do. An *agent* is a skin plus a
// backend you picked (a Builder profile, or the built-in engine the tab has
// always used). The skin says nothing about which account answers; that is the
// backend's job, which is what makes "Claude – work" and "Claude – personal"
// two different agents wearing the same skin.
//
// This file is imported by both the client and the server, so it must stay free
// of node builtins.

export type BackendKind = "builder" | "builtin" | "router";

export interface Skin {
  id: string;
  label: string;
  /** The classic tab this skin came from. Still live — deep links keep working. */
  route: string;
  backendKinds: BackendKind[];
  /**
   * CLI catalog ids (see lib/builders/clis.ts) a Builder must belong to for this
   * skin. Empty means no Builder can drive it — the skin carries its own engine.
   */
  accepts: string[];
  /**
   * What the classic tab does that an agent instance does not carry. These are
   * listed honestly rather than half-wired: an instance is a chat bound to one
   * account, and the extras below still live on the classic tab.
   */
  extras: string[];
  accent: string;
  notes: string;
}

/**
 * v1 is deliberately narrow: a skin accepts only the CLI it was built against,
 * because that is the only pairing the Phase 1 spike actually proved. Cross-CLI
 * pairs (a Claude skin driven by a Kimi Builder) are representable here but are
 * not claimed until one is verified end to end.
 */
const SKINS: Skin[] = [
  {
    id: "claude", label: "Claude", route: "/claude",
    backendKinds: ["builder"], accepts: ["claude"],
    extras: ["Workspace", "Artifacts", "Ultracode", "Ant CLI", "Sub-agents"],
    accent: "#d97757",
    notes: "Claude Code. Each Builder profile carries its own CLAUDE_CONFIG_DIR, so two agents can hold two logins.",
  },
  {
    id: "openclaw", label: "OpenClaw", route: "/openclaw",
    backendKinds: ["builder"], accepts: ["openclaw"],
    extras: ["Workspace", "Studio"],
    accent: "#f472b6",
    notes: "OpenClaw CLI.",
  },
  {
    id: "hermes", label: "Hermes", route: "/hermes",
    backendKinds: ["builder"], accepts: ["hermes"],
    extras: ["Oracle", "Astros", "Studio", "Sessions", "Outreach", "Workspace", "MCPs", "Goal Mode"],
    accent: "#60a5fa",
    notes: "Hermes CLI. The classic tab is a whole console; an instance is the chat half bound to one profile.",
  },
  {
    id: "antigravity", label: "Antigravity", route: "/antigravity",
    backendKinds: ["builder"], accepts: ["antigravity"],
    extras: ["Workspace"],
    accent: "#7c3aed",
    notes: "Google's successor to the retired Gemini CLI.",
  },
  {
    id: "codex", label: "Codex", route: "/codex",
    backendKinds: ["builder"], accepts: ["codex"],
    extras: ["Sessions", "Chats", "Goals", "Workspace"],
    accent: "#22c55e",
    notes: "OpenAI Codex CLI. Profiles isolate via CODEX_HOME.",
  },
  {
    id: "kimi", label: "Kimi Code", route: "/kimi",
    backendKinds: ["builder"], accepts: ["kimi"],
    extras: ["Workspace", "Preview"],
    accent: "#00CCFF",
    notes: "Kimi Code CLI. Its stream events differ from Claude's, so the adapter is its own.",
  },
  {
    id: "grok", label: "Grok Build", route: "/grok",
    backendKinds: ["builder"], accepts: ["grok"],
    extras: [],
    accent: "#cdd3f7",
    notes: "Grok Build CLI.",
  },
  {
    id: "freeclaude", label: "Free Claude Code", route: "/freeclaude",
    backendKinds: ["builder"], accepts: ["fcc"],
    extras: ["Builds", "Workspace"],
    accent: "#10b981",
    notes: "The claude binary pointed at a free proxy. Its Builder carries the proxy env, not a login.",
  },
  {
    id: "opencode", label: "opencode", route: "/opencode",
    backendKinds: ["builder"], accepts: ["opencode"],
    extras: ["Workspace", "History"],
    accent: "#38bdf8",
    notes: "opencode CLI.",
  },

  // Skins that carry their own engine. They talk to an API from inside the
  // dashboard, so there is no CLI process and no Builder to choose.
  //
  // Four of them accept a Router as well. The test is narrow and literal: a
  // router-backed instance is one chat against one OpenAI-compatible endpoint, so
  // only the skins that are already exactly that can take one. Fusion and Sakana
  // are councils — they blend several models on purpose — and pointing one at a
  // single endpoint would quietly turn it into something else wearing its name.
  {
    id: "glm", label: "GLM 5.2", route: "/glm",
    backendKinds: ["builtin", "router"], accepts: [],
    extras: [],
    accent: "#34E5B0",
    notes: "Calls the GLM API directly from the dashboard, or a Router you point it at.",
  },
  {
    id: "omniroute", label: "OmniRoute", route: "/omniroute",
    backendKinds: ["builtin", "router"], accepts: [],
    extras: ["Workspace"],
    accent: "#2dd4bf",
    notes: "Model router. Bind it to an OmniRoute Router to name the endpoint explicitly.",
  },
  {
    id: "hy3-coder", label: "Hy3 Coder", route: "/hy3-coder",
    backendKinds: ["builtin", "router"], accepts: [],
    extras: ["Workspace"],
    accent: "#3b82f6",
    notes: "Hy3 Coder, served by its own endpoint.",
  },
  {
    id: "fusion", label: "Fusion", route: "/fusion",
    backendKinds: ["builtin"], accepts: [],
    extras: ["History"],
    accent: "#d4a574",
    notes: "Multi-model fusion, run inside the dashboard. It blends several models, so one Router endpoint cannot stand in for it.",
  },
  {
    id: "sakana", label: "Sakana Fugu", route: "/sakana",
    backendKinds: ["builtin"], accepts: [],
    extras: ["History"],
    accent: "#ff5f9e",
    notes: "Sakana Fugu — a panel of models plus a judge, so one Router endpoint cannot stand in for it.",
  },
  {
    id: "local", label: "Local", route: "/local",
    backendKinds: ["builtin", "router"], accepts: [],
    extras: ["Builds", "Model picker"],
    accent: "#5eead4",
    notes: "Whatever model is loaded locally. An Ollama or LM Studio Router points it at a specific one.",
  },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function allSkins(): Skin[] { return SKINS; }
export function skinById(id: string): Skin | null { return BY_ID.get(id) ?? null; }

/** Skins an instance page can render without a Builder. A skin that also accepts
 *  a Router is still one of them — what matters is that no CLI is required. */
export function isBuiltinSkin(s: Skin): boolean {
  return !s.backendKinds.includes("builder");
}

export interface Compatibility { ok: boolean; reason: string }

/**
 * Can this skin be driven by a Builder belonging to `cli`?
 *
 * The reason matters as much as the answer: the create flow greys out the
 * incompatible options and shows this text, so an impossible pairing is
 * explained up front instead of failing when the user first sends a prompt.
 */
export function skinAcceptsCli(skin: Skin, cli: string): Compatibility {
  if (!skin.backendKinds.includes("builder")) {
    return { ok: false, reason: `${skin.label} carries its own engine — it has no CLI to point at a profile.` };
  }
  if (skin.accepts.includes(cli)) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: `${skin.label} has only been proven against ${skin.accepts.join(", ")}, not ${cli}.`,
  };
}

/**
 * Can this skin be driven by a Router?
 *
 * There is no per-kind matrix here on purpose. Every Router kind speaks the same
 * OpenAI wire format, so a skin that can take one can take all of them; inventing
 * a finer-grained table would be asserting distinctions nothing has tested.
 */
export function skinAcceptsRouter(skin: Skin): Compatibility {
  if (skin.backendKinds.includes("router")) return { ok: true, reason: "" };
  if (skin.backendKinds.includes("builder")) {
    return { ok: false, reason: `${skin.label} drives a CLI, so it needs a Builder profile rather than a Router.` };
  }
  return { ok: false, reason: `${skin.label} cannot be reduced to a single endpoint — it stays on its built-in engine.` };
}
