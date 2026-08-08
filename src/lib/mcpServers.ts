// MCP server registry, stored in ~/.agentic-os/mcp-servers.json.
//
// The connector list for the runtime's MCP bridge (agentRuntime/mcp.ts): which
// servers exist, how to reach them, and which of their tools an agent may see.
// Servers are added by hand and never auto-installed — this file records what
// the user already runs; Agent OS connects, it does not fetch.
//
// Same three house rules as routers.json, for the same reasons: writes are
// serialized and tmp/rename atomic at 0600 (env values and header values are
// credentials — an Authorization header is exactly an API key), a corrupted
// file is reported never repaired, and secrets leave here only through
// publicMcpServer() with every env/header VALUE masked. The masked value that
// comes back in a PATCH is ignored, so a round-trip through the UI can never
// replace a working credential with "sk-…9f2c".
//
// The home is resolved per call, not cached at import: the QA suite points
// AGENTIC_OS_HOME at a temp dir after this module has already been imported.

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { AGENTIC_HOME, RegistryCorrupt, slugify, maskSecret, isMasked } from "./builders/registry";
import type { McpServerConfig } from "./agentRuntime/mcp";

export interface McpServer extends McpServerConfig {
  enabled: boolean;
  notes: string;
  createdAt: string;
}

interface RegistryFile { version: 1; servers: McpServer[] }
interface SecretVaultFile { version: 1; secrets: Record<string, string> }

function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }
function file(): string { return path.join(home(), "mcp-servers.json"); }
function secretFile(): string { return path.join(home(), "mcp-secrets.json"); }
const MANAGED_SECRET_PREFIX = "secret://managed/";

// ---------------------------------------------------------------- persistence

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

function strMap(v: unknown): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("Give env/headers as an object of string values.");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(val);
  return out;
}

function normalize(s: Partial<McpServer>): McpServer {
  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? s.id ?? ""),
    transport: s.transport === "stdio" ? "stdio" : "http",
    command: s.command ? String(s.command) : undefined,
    args: Array.isArray(s.args) ? s.args.map(String) : undefined,
    env: s.env && typeof s.env === "object" ? { ...(s.env as Record<string, string>) } : undefined,
    url: s.url ? String(s.url) : undefined,
    headers: s.headers && typeof s.headers === "object" ? { ...(s.headers as Record<string, string>) } : undefined,
    allowedTools: Array.isArray(s.allowedTools) ? s.allowedTools.map(String) : undefined,
    usePrefix: s.usePrefix !== false,
    callTimeoutMs: typeof s.callTimeoutMs === "number" ? s.callTimeoutMs : undefined,
    enabled: s.enabled !== false,
    notes: String(s.notes ?? ""),
    createdAt: String(s.createdAt ?? new Date().toISOString()),
  };
}

async function readFileRaw(): Promise<RegistryFile | null> {
  const f = file();
  if (!existsSync(f)) return null;
  let text: string;
  try { text = await readFile(f, "utf8"); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!text.trim()) return { version: 1, servers: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as RegistryFile).servers)) {
    throw new RegistryCorrupt(f, "no servers array");
  }
  const vault = await readSecretVault();
  return {
    version: 1,
    servers: (parsed as RegistryFile).servers.map((server) => normalize({
      ...server,
      env: resolveSecretMap(server.env, vault, f),
      headers: resolveSecretMap(server.headers, vault, f),
    })),
  };
}

async function writeAtomic(data: RegistryFile): Promise<void> {
  const f = file();
  await mkdir(home(), { recursive: true });
  const vault: SecretVaultFile = { version: 1, secrets: {} };
  const stored: RegistryFile = {
    version: 1,
    servers: data.servers.map((server) => ({
      ...server,
      env: referenceSecretMap(server.id, "env", server.env, vault),
      headers: referenceSecretMap(server.id, "header", server.headers, vault),
    })),
  };
  await writeJsonAtomic(secretFile(), vault, 0o600);
  const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  // The registry contains opaque references only. The separately permissioned
  // vault is written first, so a crash can leave an unused secret but can
  // never publish a reference whose value was not durable.
  await writeFile(tmp, JSON.stringify(stored, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, f);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

async function readSecretVault(): Promise<SecretVaultFile> {
  const f = secretFile();
  if (!existsSync(f)) return { version: 1, secrets: {} };
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(f, "utf8")); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!parsed || typeof parsed !== "object"
    || !(parsed as SecretVaultFile).secrets
    || typeof (parsed as SecretVaultFile).secrets !== "object") {
    throw new RegistryCorrupt(f, "no secrets object");
  }
  return { version: 1, secrets: { ...(parsed as SecretVaultFile).secrets } };
}

function resolveSecretMap(
  values: Record<string, string> | undefined,
  vault: SecretVaultFile,
  registryFile: string,
): Record<string, string> | undefined {
  if (!values) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value.startsWith(MANAGED_SECRET_PREFIX)) {
      // Legacy v1 inline value. It is migrated to a reference on the next
      // create/update/delete write without breaking existing installations.
      resolved[key] = value;
      continue;
    }
    const secret = vault.secrets[value];
    if (secret === undefined) {
      throw new RegistryCorrupt(registryFile, `missing secret value for ${value}`);
    }
    resolved[key] = secret;
  }
  return resolved;
}

function referenceSecretMap(
  serverId: string,
  scope: "env" | "header",
  values: Record<string, string> | undefined,
  vault: SecretVaultFile,
): Record<string, string> | undefined {
  if (!values) return undefined;
  const references: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const encoded = Buffer.from(`${serverId}\0${scope}\0${key}`, "utf8").toString("base64url");
    const ref = `${MANAGED_SECRET_PREFIX}${encoded}`;
    references[key] = ref;
    vault.secrets[ref] = value;
  }
  return references;
}

async function writeJsonAtomic(target: string, value: unknown, mode: number): Promise<void> {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode });
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- validation

/** The name becomes the tool prefix, so it must be a tool-name-safe slug. */
function prefixable(name: string): string {
  const slug = slugify(name);
  if (!slug) throw new Error("Give the server a name with at least one letter or digit — it becomes the tool prefix.");
  return slug;
}

function validateShape(s: Pick<McpServer, "transport" | "command" | "url">): void {
  if (s.transport === "stdio") {
    if (!s.command?.trim()) throw new Error("A stdio server needs the command to spawn (Agent OS runs it, it never installs it).");
    return;
  }
  const raw = String(s.url ?? "").trim();
  if (!raw) throw new Error("An http server needs its endpoint URL.");
  let u: URL;
  try { u = new URL(raw); }
  catch { throw new Error("That is not a URL. It should look like http://localhost:3737/mcp."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`An MCP server URL must be http or https, not ${u.protocol.replace(":", "")}.`);
  }
  if (u.username || u.password) {
    throw new Error("Take the sign-in out of the URL. Put the credential in a header, where it is masked.");
  }
}

// ------------------------------------------------------------------ public API

export async function listMcpServers(): Promise<McpServer[]> {
  return (await readFileRaw())?.servers ?? [];
}

export async function getMcpServer(id: string): Promise<McpServer | null> {
  return (await listMcpServers()).find((s) => s.id === id) ?? null;
}

/** The configs the runtime should connect: enabled servers, secrets intact. */
export async function enabledMcpConfigs(): Promise<McpServerConfig[]> {
  return (await listMcpServers()).filter((s) => s.enabled);
}

export interface CreateMcpServerInput {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
  usePrefix?: boolean;
  enabled?: boolean;
  notes?: string;
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give the server a name.");
  const slug = prefixable(name);
  const transport = input.transport === "stdio" ? "stdio" as const : "http" as const;
  validateShape({ transport, command: input.command, url: input.url });

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, servers: [] };
    let id = slug;
    for (let n = 2; f.servers.some((s) => s.id === id); n++) id = `${slug}-${n}`;
    const server = normalize({
      ...input, id, name: slug, transport,
      enabled: input.enabled !== false,
      createdAt: new Date().toISOString(),
    });
    f.servers.push(server);
    await writeAtomic(f);
    return server;
  });
}

export interface PatchMcpServerInput {
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  allowedTools?: string[] | null;
  usePrefix?: boolean;
  enabled?: boolean;
  notes?: string;
}

/** Masked values round-trip harmlessly: a value that IS a mask keeps the stored secret. */
function mergeSecrets(
  next: Record<string, string> | undefined,
  prev: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (next === undefined) return prev;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(next)) out[k] = isMasked(v) && prev?.[k] !== undefined ? prev[k] : v;
  return out;
}

export async function updateMcpServer(id: string, patch: PatchMcpServerInput): Promise<McpServer> {
  return serialized(async () => {
    const f = await readFileRaw();
    const s = f?.servers.find((x) => x.id === id);
    if (!f || !s) throw new Error(`No MCP server "${id}".`);

    if (patch.transport !== undefined) s.transport = patch.transport === "stdio" ? "stdio" : "http";
    if (patch.command !== undefined) s.command = patch.command.trim() || undefined;
    if (patch.args !== undefined) s.args = patch.args.map(String);
    if (patch.url !== undefined) s.url = patch.url.trim() || undefined;
    s.env = mergeSecrets(strMap(patch.env), s.env);
    s.headers = mergeSecrets(strMap(patch.headers), s.headers);
    if (patch.allowedTools !== undefined) s.allowedTools = patch.allowedTools === null ? undefined : patch.allowedTools.map(String);
    if (patch.usePrefix !== undefined) s.usePrefix = Boolean(patch.usePrefix);
    if (patch.enabled !== undefined) s.enabled = Boolean(patch.enabled);
    if (patch.notes !== undefined) s.notes = String(patch.notes);

    validateShape(s);
    await writeAtomic(f);
    return s;
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    if (!f?.servers.some((x) => x.id === id)) throw new Error(`No MCP server "${id}".`);
    f.servers = f.servers.filter((x) => x.id !== id);
    await writeAtomic(f);
  });
}

// -------------------------------------------------------------------- masking

export interface PublicMcpServer extends Omit<McpServer, "env" | "headers"> {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/** The shape safe to send over HTTP: every env/header VALUE is masked. */
export function publicMcpServer(s: McpServer): PublicMcpServer {
  const maskMap = (m?: Record<string, string>) =>
    m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, maskSecret(v)])) : undefined;
  return { ...s, env: maskMap(s.env), headers: maskMap(s.headers) };
}
