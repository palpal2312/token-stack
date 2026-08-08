// One chat turn against one Builder profile.
//
// This is the Arena's lane runner with the racing taken out: same spawn, same
// protocol adapters, same process-tree kill on timeout — because a turn typed
// into an agent and a turn run in a race are the same act, and having two
// spawners would mean two sets of bugs.
//
// The difference is what it produces: a race wants metrics, a chat wants the
// answer text, so this returns the assembled reply for the history file.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Builder } from "./registry";
import type { CliCapabilityDeclaration } from "./clis/base";
import { resolveBuilderSpawn, BuilderSpawnError } from "./spawn";
import { LineExtractor } from "./protocol";
import { AGENT_CHATS } from "./history";
import { agentEnv, killTree } from "../runner";
import { loadPtySpawn, type PtySpawnFn } from "./ptySpawn";

/** A single turn should not hang a page forever; override for slow local models. */
export const CHAT_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.AGENTIC_OS_CHAT_TIMEOUT_MS) || 5 * 60_000,
);

export type ChatEvent =
  | { t: "d"; c: string }
  | { t: "note"; c: string }
  | { t: "thought"; c: string }
  | { t: "activity"; c: string }
  | { t: "done"; code: number | null; ms: number; timedOut: boolean }
  | { t: "error"; m: string };

export interface ChatResult {
  text: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  error: string | null;
  /** The CLI session this turn ran in, when the CLI names one — chat callers
   * store it to resume next turn instead of packing history. */
  sessionId: string | null;
  /** The model the lane says actually answered; null when the protocol does not report it. */
  actualModel: string | null;
  /** Time to first visible token, when the lane streams (null when it doesn't). */
  ttfbMs: number | null;
  /** Per-turn token accounting, null when the protocol does not report it. */
  usage: { input?: number; output?: number; thinking?: number } | null;
  /** Structured protocol failure, distinct from CLI/runtime errors. */
  protocolError: string | null;
  /** True only when the turn was stopped by its AbortSignal. */
  aborted: boolean;
  /** Optional declaration telemetry; it never changes successful text semantics. */
  capability?: CliCapabilityDeclaration;
}

export interface ChatOptions {
  builder: Builder;
  /** Already packed with history by the caller. */
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Full argv override (e.g. a resume-args variant of execArgs). The spawn,
   * kill, and streaming logic is identical either way — do not fork it.
   */
  argsOverride?: string[];
  /**
   * Args appended AFTER the CLI-facing arg list — applied to execArgs and
   * argsOverride alike, so one injection point covers fresh and resume turns.
   * The delegation toolkit uses this for workflow-knob args; last position is
   * deliberate: the verified CLIs' parsers (commander/clap) accept flags after
   * the positional prompt, and a later flag wins where the CLI dedupes.
   */
  argsSuffix?: string[];
  /**
   * Extra env for the child, merged UNDER the profile's own identity vars
   * (the delegation toolkit uses it to pass DELEGATE_DEPTH down one hop).
   */
  extraEnv?: Record<string, string>;
  emit: (e: ChatEvent) => void;
}

export async function runBuilderChat(opts: ChatOptions): Promise<ChatResult> {
  const { builder, prompt, emit } = opts;
  const timeoutMs = opts.timeoutMs ?? CHAT_TIMEOUT_MS;
  const started = Date.now();
  const fail = (m: string): ChatResult => {
    emit({ t: "error", m });
    return {
      text: "", exitCode: null, durationMs: Date.now() - started, timedOut: false,
      error: m, sessionId: null, actualModel: null, ttfbMs: null, usage: null,
      protocolError: null, aborted: opts.signal?.aborted === true,
    };
  };

  let resolved;
  try { resolved = resolveBuilderSpawn(builder); }
  catch (e) { return fail(e instanceof BuilderSpawnError ? e.message : String((e as Error)?.message ?? e)); }
  const capability = resolved.spec.capability ? { ...resolved.spec.capability } : undefined;
  for (const w of resolved.warnings) emit({ t: "note", c: w });

  const cwd = opts.cwd ?? os.homedir();
  await mkdir(cwd, { recursive: true }).catch(() => { /* an existing dir is the normal case */ });

  // argsPrefix always applies (the fixture builder's script path lives there);
  // the override only replaces the CLI-facing arg list.
  const args = [
    ...(resolved.argsPrefix ?? []),
    ...(opts.argsOverride ?? resolved.spec.execArgs(prompt, { model: resolved.model, effort: resolved.effort })),
    ...(opts.argsSuffix ?? []),
  ];

  const extractor = new LineExtractor(resolved.spec.protocol);
  // Surface tool activity live (agy's run_command, codex's command_execution) —
  // the same rolling status line the persistent lanes drive. Tools the CLI's
  // permission mode denies are collected and reported once at turn end.
  const deniedTools = new Set<string>();
  extractor.onEvent = (ev) => {
    if (ev.type === "tool_use") {
      emit({ t: "activity", c: `đang chạy: ${ev.name ?? "tool"}${ev.detail ? ` ${ev.detail}` : ""}` });
    } else if (ev.type === "status" && ev.text?.startsWith("tool-denied:")) {
      deniedTools.add(ev.text.slice("tool-denied:".length));
    }
  };
  let text = "";
  let timedOut = false;
  let aborted = false;
  // Time to the first visible token, matching the persistent lanes' contract.
  let firstDAt: number | null = null;
  const markFirstD = () => { if (firstDAt === null) firstDAt = Date.now(); };

  // A CLI whose spec sets requiresPty (agy.exe — verified to exit silently on a
  // plain pipe) spawns through node-pty instead of child_process.spawn. The
  // adapter quacks like the ChildProcess this lane drives, so everything below
  // — streaming, timeout, abort, kill — stays this lane's own code; only the
  // spawn line branches. node-pty loads lazily and can fail on a broken native
  // install: that fails this turn with an explained error, not the dashboard.
  let ptySpawn: PtySpawnFn | null = null;
  if (resolved.spec.requiresPty) {
    try { ptySpawn = await loadPtySpawn(); }
    catch (e) {
      return fail(
        `${resolved.spec.label} needs a console to run, but the PTY layer (node-pty) failed to load: `
        + `${String((e as Error)?.message ?? e)}. Reinstall dependencies in source/.`,
      );
    }
  }

  return await new Promise<ChatResult>((resolve) => {
    // A caller retrying after an abort must not spawn a ghost turn.
    if (opts.signal?.aborted) {
      resolve(fail("Stopped before the turn started."));
      return;
    }
    let child;
    try {
      // The profile's identity vars win over the caller's extras.
      const env = agentEnv({ ...(opts.extraEnv ?? {}), ...resolved.extraEnv });
      child = ptySpawn
        ? ptySpawn(resolved.binOverride!, args, { cwd, env })
        : spawn(resolved.binOverride!, args, { cwd, env, windowsHide: true });
      // Close stdin immediately: the whole prompt is in argv. `codex exec`
      // announces "Reading additional input from stdin..." and WAITS for EOF on
      // an open pipe — leaving stdin open hangs the turn before it starts.
      child.stdin.end();
    } catch (e) {
      resolve(fail(`Could not start ${builder.name}: ${String((e as Error)?.message ?? e)}`));
      return;
    }

    let settled = false;
    // killTree, not child.kill: the CLI's real work happens in grandchildren,
    // and on Windows killing only the parent leaves them running behind a turn
    // the user was told had stopped.
    const stop = () => { if (!settled) killTree(child); };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      emit({ t: "note", c: `Stopped after ${Math.round(timeoutMs / 1000)}s.` });
      stop();
    }, timeoutMs);

    // The browser closing the stream is the user walking away mid-answer. Nothing
    // is listening any more, so the process must not keep spending tokens.
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      emit({ t: "note", c: "Stopped — the page went away." });
      stop();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (code: number | null, err?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      const tail = extractor.flush();
      if (tail) { markFirstD(); emit({ t: "d", c: tail }); text += tail; }
      if (deniedTools.size) {
        emit({ t: "note", c: `Tool bị từ chối/lỗi quyền: ${[...deniedTools].join(", ")} — worker đang ở permission mode request-review; bật skip ở CLI Config nếu muốn chạy unattended.` });
      }
      const durationMs = Date.now() - started;
      emit({ t: "done", code, ms: durationMs, timedOut });
      resolve({
        text, exitCode: code, durationMs, timedOut,
        error: err ?? extractor.protocolError ?? extractor.errorText ?? (aborted
          ? "The turn was aborted."
          : timedOut
            ? `Timed out after ${Math.round(timeoutMs / 1000)}s.`
            : !text.trim() && code !== 0 ? `Exited with code ${code} and no reply.` : null),
        sessionId: extractor.sessionId,
        actualModel: extractor.model,
        ttfbMs: firstDAt !== null ? firstDAt - started : null,
        usage: extractor.usage,
        protocolError: extractor.protocolError,
        aborted,
        ...(capability ? { capability } : {}),
      });
    };

    child.stdout.on("data", (b: Buffer) => {
      const piece = extractor.push(b.toString());
      if (piece) { markFirstD(); text += piece; emit({ t: "d", c: piece }); }
    });
    // stderr is a note, never part of the answer: CLIs write progress and
    // warnings there, and folding it into the reply would save it as something
    // the agent said.
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString().trim();
      if (s) emit({ t: "note", c: s.slice(0, 400) });
    });
    child.on("error", (e) => {
      emit({ t: "error", m: String(e.message ?? e) });
      finish(null, String(e.message ?? e));
    });
    child.on("close", (code) => finish(code));
  });
}

/** Scratch directory a builder-backed agent runs its turns in. */
export function agentWorkDir(agentId: string): string {
  return path.join(AGENT_CHATS, agentId, "work");
}
