// Durable workspace for the Agent Kanban — every build the local team makes is
// saved here so it survives reloads + reboots (unlike /tmp). One HTML file per
// build + a manifest with the metadata the workspace gallery shows.
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { withFileLock } from "./fileLock";
import { writeTextAtomic } from "./llmops/storage";

function root(): string {
  return path.join(process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"), "agent-kanban");
}
function buildsDir(): string { return path.join(root(), "builds"); }
function manifestFile(): string { return path.join(root(), "manifest.json"); }

export interface BuildRec {
  id: string; title: string; brief: string; goal: string;
  model: string; bytes: number; createdAt: number;
}

export function buildPath(id: string): string { return path.join(buildsDir(), `${id}.html`); }

async function readManifest(): Promise<BuildRec[]> {
  try { return JSON.parse(await readFile(manifestFile(), "utf8")); } catch { return []; }
}
async function writeManifest(recs: BuildRec[]): Promise<void> {
  await mkdir(root(), { recursive: true });
  await writeTextAtomic(manifestFile(), JSON.stringify(recs.slice(-300)));
}

// Manifest updates are read-modify-write: the promise chain serializes them
// in-process, the file lock is the cross-process barrier against a second
// server sharing this AGENTIC_OS_HOME. Lock inside the chain, never the
// reverse, so a process can never deadlock against itself.
let writeChain: Promise<unknown> = Promise.resolve();

async function updateManifest(fn: (recs: BuildRec[]) => BuildRec[]): Promise<void> {
  const run = () => withFileLock(root(), "builds-manifest", async () => {
    await writeManifest(fn(await readManifest()));
  });
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
}

export async function recordBuild(rec: BuildRec, html: string): Promise<void> {
  await mkdir(buildsDir(), { recursive: true });
  await writeFile(buildPath(rec.id), html, "utf8");
  await updateManifest((m) => [...m.filter((r) => r.id !== rec.id), rec]);
}

// Newest first; drop any whose file vanished.
export async function listBuilds(): Promise<BuildRec[]> {
  const m = await readManifest();
  return m.filter((r) => existsSync(buildPath(r.id))).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBuild(id: string): Promise<void> {
  await updateManifest((m) => m.filter((r) => r.id !== id));
  try { await unlink(buildPath(id)); } catch { /* already gone */ }
}
