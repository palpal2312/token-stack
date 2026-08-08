// Racing Builder profiles: one prompt, several profiles, side by side.
//
// The hard part is not the racing, it is that every CLI reports itself
// differently. `claude -p --output-format stream-json` emits one JSON event per
// line with the assistant's words buried in content deltas; `codex exec --json`
// uses a different envelope again; the rest just print. This module turns all of
// them into one lane event shape so the page can render them identically and the
// metrics mean the same thing across profiles.
//
// Nothing here decides *whether* to spend money — the route does that, after the
// user confirms. This module only runs what it is handed.

import { spawn } from "node:child_process";
import { mkdir, appendFile, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { AGENTIC_HOME } from "./registry";
import type { Builder } from "./registry";
import { resolveBuilderSpawn, BuilderSpawnError } from "./spawn";
import { agentEnv, killTree } from "../runner";

export const ARENA_HOME = path.join(AGENTIC_HOME, "arena");
export const ARENA_WORK = path.join(ARENA_HOME, "work");
export const ARENA_RUNS = path.join(ARENA_HOME, "runs.jsonl");

export const MAX_LANES = 4;
/** Overridable so the timeout path can be exercised without a five-minute test. */
export const LANE_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.AGENTIC_OS_ARENA_TIMEOUT_MS) || 5 * 60_000,
);
/** Work dirs older than this are swept when a new run starts. */
const KEEP_WORK_MS = 14 * 24 * 60 * 60_000;

export type LaneEvent =
  | { lane: string; t: "d"; c: string }
  | { lane: string; t: "note"; c: string }
  | { lane: string; t: "done"; code: number | null; ms: number; bytes: number; ttfbMs: number | null }
  | { lane: string; t: "error"; m: string };

export interface LaneResult {
  builderId: string;
  cli: string;
  name: string;
  ttfbMs: number | null;
  durationMs: number;
  exitCode: number | null;
  bytes: number;
  outputPath: string | null;
  error: string | null;
  timedOut: boolean;
}

export interface ArenaRun {
  runId: string;
  ts: string;
  prompt: string;
  lanes: LaneResult[];
  winner?: string | null;
  note?: string;
}

// ------------------------------------------------------------------ adapters
//
// The protocol adapters live in ./protocol now (one NormalizedEvent shape per
// CLI protocol, shared by the skins' chat routes). They are re-exported here
// because this module grew them first and callers (runBuilderChat, the QA
// suite) import them from "./arena".

export { extractText, LineExtractor } from "./protocol";

import { LineExtractor } from "./protocol";

// ---------------------------------------------------------------- the runner

/**
 * Run one Builder against the prompt in its own scratch directory.
 *
 * Every lane is independent: a profile that cannot spawn reports its reason and
 * finishes, while the others keep going. That is the whole point of an arena —
 * a broken profile is a result, not an outage.
 */
async function runLane(
  builder: Builder,
  prompt: string,
  runId: string,
  emit: (e: LaneEvent) => void,
  timeoutMs: number,
): Promise<LaneResult> {
  const lane = builder.id;
  const base: LaneResult = {
    builderId: builder.id, cli: builder.cli, name: builder.name,
    ttfbMs: null, durationMs: 0, exitCode: null, bytes: 0,
    outputPath: null, error: null, timedOut: false,
  };

  let resolved;
  try { resolved = resolveBuilderSpawn(builder); }
  catch (e) {
    const m = e instanceof BuilderSpawnError ? e.message : String((e as Error)?.message ?? e);
    emit({ lane, t: "error", m });
    return { ...base, error: m };
  }
  for (const w of resolved.warnings) emit({ lane, t: "note", c: w });

  const cwd = path.join(ARENA_WORK, runId, builder.id);
  await mkdir(cwd, { recursive: true });
  const outputPath = path.join(cwd, "output.txt");

  const args = [
    ...(resolved.argsPrefix ?? []),
    ...resolved.spec.execArgs(prompt, { model: resolved.model, effort: resolved.effort }),
  ];

  const started = Date.now();
  const extractor = new LineExtractor(resolved.spec.protocol);
  let bytes = 0;
  let ttfbMs: number | null = null;
  let raw = "";

  return await new Promise<LaneResult>((resolve) => {
    let child;
    try {
      child = spawn(resolved.binOverride!, args, {
        cwd,
        env: agentEnv(resolved.extraEnv),
        windowsHide: true,
      });
      // Same contract as runBuilderChat: the prompt is all in argv, so close
      // stdin — `codex exec` waits for EOF on an open pipe before it starts.
      child.stdin.end();
    } catch (e) {
      const m = `Could not start ${builder.name}: ${String((e as Error)?.message ?? e)}`;
      emit({ lane, t: "error", m });
      resolve({ ...base, error: m, durationMs: Date.now() - started });
      return;
    }

    let settled = false;
    // killTree, not child.kill: on Windows a CLI's real work happens in
    // grandchildren, and killing only the parent leaves them burning tokens
    // behind a lane the user was told had timed out.
    const timer = setTimeout(() => {
      if (settled) return;
      base.timedOut = true;
      emit({ lane, t: "note", c: `Stopped after ${Math.round(timeoutMs / 1000)}s.` });
      killTree(child);
    }, timeoutMs);

    const finish = async (code: number | null, err?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tail = extractor.flush();
      if (tail) { emit({ lane, t: "d", c: tail }); raw += tail; }
      try { await writeFile(outputPath, raw, "utf8"); } catch { /* the run still counts */ }
      const durationMs = Date.now() - started;
      emit({ lane, t: "done", code, ms: durationMs, bytes, ttfbMs });
      resolve({
        ...base, ttfbMs, durationMs, exitCode: code, bytes,
        outputPath, error: err ?? null,
        timedOut: base.timedOut,
      });
    };

    child.stdout.on("data", (b: Buffer) => {
      const s = b.toString();
      bytes += b.length;
      const text = extractor.push(s);
      if (text) {
        if (ttfbMs === null) ttfbMs = Date.now() - started;
        raw += text;
        emit({ lane, t: "d", c: text });
      }
    });
    // stderr is a note, not lane output: CLIs write progress and warnings there,
    // and mixing it into the answer would make one profile look more verbose.
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString().trim();
      if (s) emit({ lane, t: "note", c: s.slice(0, 400) });
    });
    child.on("error", (e) => {
      emit({ lane, t: "error", m: String(e.message ?? e) });
      void finish(null, String(e.message ?? e));
    });
    child.on("close", (code) => {
      void finish(code, base.timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s.` : undefined);
    });
  });
}

export interface ArenaOptions {
  prompt: string;
  builders: Builder[];
  runId: string;
  timeoutMs?: number;
  emit: (e: LaneEvent) => void;
}

/** Race every builder at once and return one result row each. */
export async function runArena(opts: ArenaOptions): Promise<LaneResult[]> {
  await mkdir(ARENA_WORK, { recursive: true });
  return await Promise.all(
    opts.builders.map((b) => runLane(b, opts.prompt, opts.runId, opts.emit, opts.timeoutMs ?? LANE_TIMEOUT_MS)),
  );
}

// -------------------------------------------------------------------- history

let appendChain: Promise<unknown> = Promise.resolve();

/**
 * Append one run to the history.
 *
 * Serialized because two races can finish at once, and two interleaved appends
 * would produce a line that is neither run. The whole row is written at once, so
 * a crash mid-run loses that run rather than corrupting the file.
 */
export async function appendRun(run: ArenaRun): Promise<void> {
  const next = appendChain.then(async () => {
    await mkdir(ARENA_HOME, { recursive: true });
    await appendFile(ARENA_RUNS, JSON.stringify(run) + "\n", "utf8");
  });
  appendChain = next.catch(() => {});
  return next;
}

export async function listRuns(limit = 50): Promise<ArenaRun[]> {
  if (!existsSync(ARENA_RUNS)) return [];
  const text = await readFile(ARENA_RUNS, "utf8");
  const runs: ArenaRun[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // One bad line is one lost run, not a broken history page.
    try { runs.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return runs.reverse().slice(0, limit);
}

/** Rewrite one run's winner/note in place. */
export async function updateRun(runId: string, patch: { winner?: string | null; note?: string }): Promise<ArenaRun | null> {
  const next = appendChain.then(async (): Promise<ArenaRun | null> => {
    if (!existsSync(ARENA_RUNS)) return null;
    const lines = (await readFile(ARENA_RUNS, "utf8")).split("\n");
    let found: ArenaRun | null = null;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      let r: ArenaRun;
      try { r = JSON.parse(line); } catch { return line; }
      if (r.runId !== runId) return line;
      if (patch.winner !== undefined) r.winner = patch.winner;
      if (patch.note !== undefined) r.note = patch.note;
      found = r;
      return JSON.stringify(r);
    });
    if (found) {
      const tmp = `${ARENA_RUNS}.${process.pid}.tmp`;
      await writeFile(tmp, out.join("\n"), "utf8");
      const { rename } = await import("node:fs/promises");
      await rename(tmp, ARENA_RUNS);
    }
    return found;
  });
  appendChain = next.catch(() => {});
  return next;
}

/**
 * Delete work directories older than the keep window.
 *
 * History rows that pointed into a swept directory get their `outputPath`
 * nulled in the same pass, so the UI never offers a link to a file that is gone.
 */
export async function pruneOldWork(): Promise<string[]> {
  if (!existsSync(ARENA_WORK)) return [];
  const cutoff = Date.now() - KEEP_WORK_MS;
  const pruned: string[] = [];
  for (const entry of await readdir(ARENA_WORK)) {
    const dir = path.join(ARENA_WORK, entry);
    try {
      const s = await stat(dir);
      if (s.mtimeMs >= cutoff) continue;
      await rm(dir, { recursive: true, force: true });
      pruned.push(entry);
    } catch { /* leave it for the next sweep */ }
  }

  if (pruned.length && existsSync(ARENA_RUNS)) {
    const gone = new Set(pruned);
    const lines = (await readFile(ARENA_RUNS, "utf8")).split("\n");
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      let r: ArenaRun;
      try { r = JSON.parse(line); } catch { return line; }
      if (!gone.has(r.runId)) return line;
      r.lanes = r.lanes.map((l) => ({ ...l, outputPath: null }));
      return JSON.stringify(r);
    });
    await writeFile(ARENA_RUNS, out.join("\n"), "utf8");
  }
  return pruned;
}
