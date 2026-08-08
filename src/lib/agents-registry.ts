// Agent instances, stored in ~/.agentic-os/agents.json.
//
// An instance is the pairing the user made: this skin, driven by this backend,
// under this name. It holds no secrets of its own — the Builder it points at
// holds those — but it lives next to builders.json and follows the same three
// rules: writes are atomic and serialized, a corrupted file is reported rather
// than replaced, and a missing file is simply empty.
//
// It is emphatically NOT seeded. The user asked for the Agents section to start
// empty, and an auto-created agent would be a choice made on their behalf about
// which account answers.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { AGENTIC_HOME, RegistryCorrupt, slugify, getBuilder } from "./builders/registry";
import { getRouter } from "./routers/registry";
import { skinById, skinAcceptsCli, skinAcceptsRouter, type BackendKind } from "./skins";

export const AGENTS_FILE = path.join(AGENTIC_HOME, "agents.json");

export interface AgentBackend {
  kind: BackendKind;
  /** Builder id for kind "builder"; router id for kind "router" (Phase 8). */
  refId?: string;
}

export interface AgentInstance {
  id: string;
  name: string;
  skinId: string;
  backend: AgentBackend;
  model: string | null;
  notes: string;
  createdAt: string;
}

interface AgentsFile { version: 1; agents: AgentInstance[] }

// ---------------------------------------------------------------- persistence

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

function normalize(a: Partial<AgentInstance>): AgentInstance {
  const kind = (a.backend?.kind ?? "builtin") as BackendKind;
  return {
    id: String(a.id ?? ""),
    name: String(a.name ?? a.id ?? ""),
    skinId: String(a.skinId ?? ""),
    backend: { kind, refId: a.backend?.refId ? String(a.backend.refId) : undefined },
    model: a.model ?? null,
    notes: String(a.notes ?? ""),
    createdAt: String(a.createdAt ?? new Date().toISOString()),
  };
}

async function readFileRaw(): Promise<AgentsFile | null> {
  if (!existsSync(AGENTS_FILE)) return null;
  let text: string;
  try { text = await readFile(AGENTS_FILE, "utf8"); }
  catch (e) { throw new RegistryCorrupt(AGENTS_FILE, e); }
  if (!text.trim()) return { version: 1, agents: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(AGENTS_FILE, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AgentsFile).agents)) {
    throw new RegistryCorrupt(AGENTS_FILE, "no agents array");
  }
  return { version: 1, agents: (parsed as AgentsFile).agents.map(normalize) };
}

async function writeAtomic(data: AgentsFile): Promise<void> {
  await mkdir(AGENTIC_HOME, { recursive: true });
  const tmp = `${AGENTS_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, AGENTS_FILE);
}

// ----------------------------------------------------------------- validation

/**
 * Check a skin/backend pairing at save time, so an impossible agent can never be
 * written. The reasons are the ones the create flow shows.
 */
async function validatePairing(skinId: string, backend: AgentBackend): Promise<void> {
  const skin = skinById(skinId);
  if (!skin) throw new Error(`There is no "${skinId}" skin.`);
  if (!skin.backendKinds.includes(backend.kind)) {
    // The skin knows why it refuses a Router — "Fusion blends several models" is
    // a reason; "cannot run on a router backend" is only a restatement.
    const why = backend.kind === "router" ? skinAcceptsRouter(skin).reason : "";
    throw new Error(
      why || `${skin.label} cannot run on a ${backend.kind} backend `
        + `(it supports: ${skin.backendKinds.join(", ")}).`,
    );
  }
  if (backend.kind === "builder") {
    if (!backend.refId) throw new Error(`${skin.label} needs a Builder profile — pick one.`);
    const b = await getBuilder(backend.refId);
    if (!b) throw new Error(`There is no Builder profile "${backend.refId}".`);
    const compat = skinAcceptsCli(skin, b.cli);
    if (!compat.ok) throw new Error(compat.reason);
  }
  if (backend.kind === "router") {
    // Compatibility was already settled above; what is left is the reference.
    if (!backend.refId) throw new Error(`${skin.label} needs a Router — pick one.`);
    const r = await getRouter(backend.refId);
    if (!r) throw new Error(`There is no Router "${backend.refId}".`);
  }
}

// ----------------------------------------------------------------- public API

export async function listAgents(): Promise<AgentInstance[]> {
  const f = await readFileRaw();
  return f?.agents ?? [];
}

export async function getAgent(id: string): Promise<AgentInstance | null> {
  return (await listAgents()).find((a) => a.id === id) ?? null;
}

export interface CreateAgentInput {
  name: string;
  skinId: string;
  backend: AgentBackend;
  model?: string | null;
  notes?: string;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentInstance> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give the agent a name.");
  if (name.length > 60) throw new Error("Keep the name under 60 characters.");
  await validatePairing(input.skinId, input.backend);

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, agents: [] };
    const base = slugify(name) || input.skinId;
    let id = base;
    for (let n = 2; f.agents.some((a) => a.id === id); n++) id = `${base}-${n}`;

    const agent = normalize({
      id, name, skinId: input.skinId,
      backend: input.backend,
      model: input.model ?? null,
      notes: input.notes ?? "",
      createdAt: new Date().toISOString(),
    });
    f.agents.push(agent);
    await writeAtomic(f);
    return agent;
  });
}

export interface PatchAgentInput {
  name?: string;
  backend?: AgentBackend;
  model?: string | null;
  notes?: string;
}

export async function updateAgent(id: string, patch: PatchAgentInput): Promise<AgentInstance> {
  // Validate before taking the write slot: the pairing check reads the builder
  // registry, and holding the chain across that is pointless contention.
  const existing = await getAgent(id);
  if (!existing) throw new Error(`No agent "${id}".`);
  if (patch.backend) await validatePairing(existing.skinId, patch.backend);

  return serialized(async () => {
    const f = await readFileRaw();
    const a = f?.agents.find((x) => x.id === id);
    if (!f || !a) throw new Error(`No agent "${id}".`);

    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw new Error("The agent needs a name.");
      a.name = n.slice(0, 60);
    }
    // The skin is fixed for the life of an instance. Changing it would silently
    // reinterpret the stored history against a different UI and backend kind;
    // making a second agent is cheap and honest.
    if (patch.backend) a.backend = { kind: patch.backend.kind, refId: patch.backend.refId };
    if (patch.model !== undefined) a.model = patch.model;
    if (patch.notes !== undefined) a.notes = String(patch.notes);

    await writeAtomic(f);
    return a;
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await serialized(async () => {
    const f = await readFileRaw();
    const a = f?.agents.find((x) => x.id === id);
    if (!f || !a) throw new Error(`No agent "${id}".`);
    f.agents = f.agents.filter((x) => x.id !== id);
    await writeAtomic(f);
  });
  // The conversation is left on disk on purpose: deleting the pairing is
  // reversible, and throwing away the transcript with it is not.
}

export interface ResolvedAgent {
  agent: AgentInstance;
  /** Null when the backend it points at is gone — the page explains and offers a rebind. */
  builderId: string | null;
  /** Set instead of builderId when the agent answers over a Router. */
  routerId: string | null;
  /** Plain-language problem, or null when the agent is ready to answer. */
  problem: string | null;
}

/**
 * Resolve an instance for rendering.
 *
 * A dangling backend reference is expected — profiles and Routers can be deleted
 * — so it resolves to an explained problem, never to a crash and never to a
 * silent fallback that would answer from somebody else's account.
 */
export async function resolveAgent(id: string): Promise<ResolvedAgent | null> {
  const agent = await getAgent(id);
  if (!agent) return null;
  const base = { agent, builderId: null, routerId: null };

  const skin = skinById(agent.skinId);
  if (!skin) {
    return { ...base, problem: `This agent wears a "${agent.skinId}" skin, which no longer exists.` };
  }
  if (agent.backend.kind === "builtin") return { ...base, problem: null };

  const refId = agent.backend.refId ?? "";

  if (agent.backend.kind === "router") {
    const r = refId ? await getRouter(refId) : null;
    if (!r) {
      return {
        ...base,
        problem: `The Router this agent used ("${refId}") is gone. `
          + `Pick another one below — it will not answer through a different endpoint until you do.`,
      };
    }
    const compat = skinAcceptsRouter(skin);
    if (!compat.ok) return { ...base, problem: compat.reason };
    return { ...base, routerId: r.id, problem: null };
  }

  const b = refId ? await getBuilder(refId) : null;
  if (!b) {
    return {
      ...base,
      problem: `The Builder profile this agent used ("${refId}") is gone. `
        + `Pick another profile below — it will not answer from a different account until you do.`,
    };
  }
  const compat = skinAcceptsCli(skin, b.cli);
  if (!compat.ok) return { ...base, problem: compat.reason };

  return { ...base, builderId: b.id, problem: null };
}
