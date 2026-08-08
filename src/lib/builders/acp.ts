// ACP lane — the fast chat channel.
//
// Instead of a cold `cli -p` per turn (process boot + 52KB AGENTS.md +
// no streaming), the ACP lane keeps ONE long-lived `kimi acp` process per
// (chat session × builder): a JSON-RPC stdio server with token-level
// streaming, warm context, and tool use intact. This is the same protocol
// editors use to embed agents — structured events, not TUI scraping.
//
// The pool is the point: the process stays alive between turns (idle-reaped
// after ACP_IDLE_MS), so turn 2+ pays no boot, no AGENTS.md re-read, and
// the answer starts streaming in ~1s.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Builder } from "./registry";
import { resolveBuilderSpawn } from "./spawn";
import { codexProfileTranslation } from "./codex-profile";
import { cliSpec } from "./clis";
import { codexModels } from "../sen-models";
import { extractText } from "./arena";
import { agentEnv, killTree } from "../runner";
import type { ChatEvent, ChatResult } from "./chat";
import { CHAT_TIMEOUT_MS } from "./chat";

export const ACP_IDLE_MS = Math.max(60_000, Number(process.env.AGENTIC_OS_ACP_IDLE_MS) || 10 * 60_000);

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** One stdio JSON-RPC connection. The current turn swaps `onNotify`. */
class AcpConn {
  private buf = "";
  private nextId = 0;
  private pending = new Map<number, { res: (v: JsonRpc) => void }>();
  onNotify: (m: JsonRpc) => void = () => {};

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (b: Buffer) => {
      this.buf += b.toString();
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let m: JsonRpc;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && this.pending.has(m.id)) {
          this.pending.get(m.id)!.res(m);
          this.pending.delete(m.id);
        } else if (m.method || (m as { type?: string }).type) {
          // JSON-RPC messages carry `method`; stream-json duplex events carry
          // only `type`. Both lanes' notifications flow through onNotify.
          this.onNotify(m);
        }
      }
    });
  }

  call(method: string, params: unknown): Promise<JsonRpc> {
    const id = ++this.nextId;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((res) => this.pending.set(id, { res }));
  }
}

interface Pooled {
  child: ChildProcessWithoutNullStreams;
  conn: AcpConn;
  acpSessionId: string;
  lastUsed: number;
  dead: boolean;
  /** Serializes turns on one process — a second prompt mid-turn would interleave. */
  busy: boolean;
  /** The model the CLI says it is actually running — from the lane itself
   * (kimi's configOptions, codex's resolved config, claude's assistant events),
   * never from the selection chain, so the UI can tell truth from choice. */
  actualModel: string | null;
  /** True when this process CONTINUES an earlier CLI session (thread/resume,
   * session/resume, --resume) — the caller then sends the raw prompt instead
   * of the history-packed one. */
  resumed: boolean;
}

const pool = new Map<string, Pooled>();
let reaper: NodeJS.Timeout | null = null;

function ensureReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [key, p] of pool) {
      if (now - p.lastUsed > ACP_IDLE_MS || p.dead) {
        pool.delete(key);
        killTree(p.child);
      }
    }
  }, 30_000);
  reaper.unref();
}

async function spawnPooled(builder: Builder, cwd: string, model?: string | null, resumeSessionId?: string | null, effort?: string | null, emit?: (e: ChatEvent) => void): Promise<Pooled> {
  const resolved = resolveBuilderSpawn(builder);
  const lane = resolved.spec.laneProtocol ?? "acp";
  let argv = [...(resolved.argsPrefix ?? [])];
  // The duplex lane's model is fixed at spawn — changing it means a new process
  // (the pool key carries the model, so that happens naturally).
  if (lane === "claude-duplex" && model) argv.push("--model", model);
  // Verified: `claude --effort` accepts low/medium/high/xhigh/max and merely
  // warns on a bogus value — a stale catalog entry can never break the spawn.
  if (lane === "claude-duplex" && effort) argv.push("--effort", effort);
  // Duplex: a stored claude session id resumes at spawn instead of cold start.
  if (lane === "claude-duplex" && resumeSessionId) argv.push("--resume", resumeSessionId);

  // `codex app-server` rejects --profile ("only applies to runtime commands"),
  // so a `-p <name>` profile is translated: flat config keys become -c flags
  // and the profile's [env] table becomes child env — secrets never hit argv.
  let extraEnv = resolved.extraEnv;
  let profileModel: string | null = null;
  if (lane === "codex-appserver") {
    const translated = await codexProfileTranslation(builder, argv);
    argv = translated.argv;
    extraEnv = { ...extraEnv, ...translated.env };
    profileModel = translated.model;
  }

  argv.push(...(resolved.spec.acpArgv ?? []));
  const child = spawn(resolved.binOverride!, argv, {
    cwd,
    env: agentEnv(extraEnv),
    windowsHide: true,
  });
  const conn = new AcpConn(child);
  if (process.env.AGENTIC_OS_ACP_DEBUG === "1") {
    child.stderr.on("data", (b: Buffer) => console.error(`[acp-lane stderr] ${b.toString().slice(0, 300)}`));
    child.on("error", (e) => console.error("[acp-lane spawn error]", e.message));
    child.on("close", (c, sig) => console.error("[acp-lane close]", c, "sig:", sig, "pid:", child.pid));
    child.stdout.on("data", (b: Buffer) => console.error("[acp-lane stdout]", b.toString().slice(0, 200)));
    console.error("[acp-lane spawn]", resolved.binOverride, JSON.stringify(argv), "cwd:", cwd, "pid:", child.pid);
  }

  if (lane === "claude-duplex") {
    // No handshake: the session id arrives on the first turn's init event.
    return { child, conn, acpSessionId: "", lastUsed: Date.now(), dead: false, busy: false, actualModel: model ?? builder.model, resumed: Boolean(resumeSessionId) };
  }

  if (lane === "codex-appserver") {
    const init = await conn.call("initialize", { clientInfo: { name: "agentic-os-firstmate", version: "1.0" } });
    if (init.error) { killTree(child); throw new Error(`codex app-server initialize refused: ${init.error.message}`); }
    let threadId: string | undefined;
    let resumed = false;
    // The server names the model it will actually use on thread start/resume —
    // verified on 0.145.0: both results carry a top-level `model` field.
    let threadModel: string | null = null;
    if (resumeSessionId) {
      // A stored thread from before the restart — resume beats re-packing history.
      const rr = await conn.call("thread/resume", { threadId: resumeSessionId });
      if (!rr.error && (rr.result as { thread?: { id?: string } } | undefined)?.thread?.id) {
        threadId = (rr.result as { thread: { id: string } }).thread.id;
        threadModel = (rr.result as { model?: string } | undefined)?.model ?? null;
        resumed = true;
      }
    }
    if (!threadId) {
      // "never": a chat lane cannot answer approval prompts — the profile's own
      // sandbox config still applies underneath. `model` pins the selection at
      // spawn (verified 0.145.0: accepted and echoed back as result.model).
      const th = await conn.call("thread/start", {
        cwd,
        approvalPolicy: "never",
        ...(model ? { model } : {}),
        // Verified on 0.145.0: accepted without error (honored per the CLI's own
        // reasoning-effort config semantics).
        ...(effort ? { effort } : {}),
      });
      threadId = (th.result as { thread?: { id?: string } } | undefined)?.thread?.id;
      threadModel = (th.result as { model?: string } | undefined)?.model ?? null;
    }
    if (!threadId) { killTree(child); throw new Error(`codex thread/start failed: no thread id`); }
    // Truth order: the server's own answer, then the profile/config-derived
    // guess (only reached when an older server omits `model`).
    const actualModel = threadModel ?? model ?? profileModel ?? builder.model ?? (await codexModels(builder)).cliDefault;
    return { child, conn, acpSessionId: threadId, lastUsed: Date.now(), dead: false, busy: false, actualModel, resumed };
  }

  const init = await conn.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "agentic-os-firstmate", version: "1.0" },
  });
  if (init.error) { killTree(child); throw new Error(`ACP initialize refused: ${init.error.message}`); }

  // A stored kimi session resumes the conversation; fall back to a fresh
  // session when the id is gone or the method is unknown.
  let resumed = false;
  let acpSessionId: string | null = null;
  let actualModel: string | null = null;
  let thoughtLevels: string[] | null = null;
  if (resumeSessionId) {
    const rr = await conn.call("session/resume", { sessionId: resumeSessionId });
    const id = (rr.result as { sessionId?: string } | undefined)?.sessionId;
    if (!rr.error && id) { acpSessionId = id; resumed = true; }
  }
  if (!acpSessionId) {
    const s = await conn.call("session/new", { cwd, mcpServers: [] });
    acpSessionId = (s.result as { sessionId?: string } | undefined)?.sessionId ?? null;
    // Kimi names the live model in configOptions — runtime-confirmed.
    interface CfgOpt { category?: string; currentValue?: string; options?: { value?: string }[] }
    const opts = (s.result as { configOptions?: CfgOpt[] } | undefined)?.configOptions ?? [];
    actualModel = opts.find((o) => o.category === "model")?.currentValue ?? null;
    thoughtLevels = opts.find((o) => o.category === "thought_level")?.options?.map((o) => String(o.value ?? "")).filter(Boolean) ?? null;
  }
  if (!acpSessionId) { killTree(child); throw new Error(`ACP session/new failed: no sessionId`); }
  // Effort: kimi exposes thought_level (configId "thinking") in configOptions —
  // verified 2026-07-29: session/set_config_option applies it and answers with
  // the updated options. Only values the session itself lists are applied;
  // anything else earns a note, never a silent pretend.
  if (effort) {
    if (thoughtLevels && !thoughtLevels.includes(effort)) {
      emit?.({ t: "note", c: `Worker này không nhận effort "${effort}" (hỗ trợ: ${thoughtLevels.join("/")}).` });
    } else {
      const sr = await conn.call("session/set_config_option", { sessionId: acpSessionId, configId: "thinking", value: effort });
      if (sr.error) emit?.({ t: "note", c: `Không đặt được effort "${effort}": ${sr.error.message}` });
    }
  }
  return { child, conn, acpSessionId, lastUsed: Date.now(), dead: false, busy: false, actualModel, resumed };
}

export interface AcpChatOptions {
  builder: Builder;
  /** Stable key for the conversation — chat session id. */
  key: string;
  prompt: string;
  /** Used instead of `prompt` when this turn ALSO boots a fresh ACP session
   * (pool miss) — the caller's history-packed variant, so a server restart
   * does not silently amputate the conversation. */
  freshPrompt?: string;
  /** A CLI session id from an earlier turn (meta.resume). On a pool miss the
   * lane tries to CONTINUE it (thread/resume, session/resume, --resume)
   * instead of starting cold and re-packing history. */
  resumeSessionId?: string | null;
  /** Model override baked into the spawned process (duplex lane). Part of the
   * pool key, so a model switch boots a fresh process. */
  model?: string | null;
  /** Reasoning effort for lanes that accept one (codex thread/start, kimi
   * thought_level). Part of the pool key for the same reason as model. */
  effort?: string | null;
  /** Pasted images — ACP image content blocks (kimi's promptCapabilities.image). */
  images?: { data: string; mimeType: string }[];
  cwd: string;
  signal?: AbortSignal;
  emit: (e: ChatEvent) => void;
}

/**
 * One chat turn over the pooled ACP process. Same ChatResult contract as
 * runBuilderChat so the route can pick either lane without forking logic.
 * A busy process (turn still running) rejects immediately rather than
 * interleaving two prompts into one stream.
 */
export async function acpChat(opts: AcpChatOptions): Promise<ChatResult> {
  const { builder, key, prompt, cwd, signal, emit } = opts;
  const started = Date.now();
  const fail = (m: string): ChatResult => {
    emit({ t: "error", m });
    return { text: "", exitCode: null, durationMs: Date.now() - started, timedOut: false, error: m, sessionId: null, actualModel: null, ttfbMs: null, usage: null, protocolError: null, aborted: false };
  };

  const effort = opts.effort ?? builder.effort ?? null;
  const poolKey = `${key}::${builder.id}::${opts.model ?? ""}::${effort ?? ""}`;
  let p = pool.get(poolKey);
  let turnPrompt = prompt;
  if (p?.busy) return fail("That worker is still answering the previous message — wait a moment, or press Stop there first.");
  try {
    if (!p || p.dead) {
      p = await spawnPooled(builder, cwd, opts.model ?? builder.model, opts.resumeSessionId ?? null, effort, emit);
      pool.set(poolKey, p);
      ensureReaper();
      // A resumed CLI session already holds the history — no re-packing.
      turnPrompt = p.resumed ? prompt : (opts.freshPrompt ?? prompt);
      emit({ t: "note", c: p.resumed
        ? "ACP lane: continued the earlier CLI session — context intact, nothing re-sent."
        : "ACP lane: warm session started — follow-ups skip the boot entirely." });
    }
  } catch (e) {
    return fail(`ACP lane could not start: ${String((e as Error)?.message ?? e)}`);
  }
  p.lastUsed = Date.now();

  let text = "";
  let ttfb: number | null = null;
  const firstD = () => { if (ttfb === null) ttfb = Date.now() - started; };
  let timedOut = false;
  const lane = (cliSpec(builder.cli)?.laneProtocol) ?? "acp";

  return await new Promise<ChatResult>((resolve) => {
    const pooled = p!;
    pooled.busy = true;
    let settled = false;

    // A lane whose process dies mid-turn must fail the turn, not hang it.
    const onChildError = (e: Error) => finish({ error: `lane process failed: ${e.message}` });
    const onChildClose = (code: number | null) => {
      if (!settled) finish({ error: `lane process exited (code ${code ?? "?"}) before the turn ended.` });
    };
    pooled.child.once("error", onChildError);
    pooled.child.once("close", onChildClose);

    if (lane === "claude-duplex") {
      // stream-json duplex: events arrive per line; a turn ends at "result".
      // The CLI DROPS stdin lines sent before its reader is up, so the first
      // message of a fresh process is held until the first event lands.
      let sent = false;
      // Rolling tail of the model's thinking, accumulated across thinking_delta
      // chunks so the activity line reads as one continuous thought.
      let thinking = "";
      const sendTurn = () => {
        if (sent) return;
        sent = true;
        // Verified 2026-07-29 (fugu-ultra): a base64 image source block in the
        // user message is genuinely seen by the model (answered "Red" to a red
        // square). Text stays a bare string when no images were pasted.
        const content = (opts.images ?? []).length
          ? [
              ...(opts.images ?? []).map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.mimeType, data: img.data },
              })),
              { type: "text", text: turnPrompt },
            ]
          : turnPrompt;
        pooled.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
      };
      pooled.conn.onNotify = (m) => {
        sendTurn();
        const e = m as unknown as Record<string, unknown>;
        if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string") {
          pooled.acpSessionId = e.session_id;
          return;
        }
        if (e.type === "result") {
          finish({ error: e.is_error === true ? (typeof e.result === "string" ? e.result : "The CLI reported an error result.") : null });
          return;
        }
        const piece = extractText("claude-stream-json", JSON.stringify(e));
        if (piece) { firstD(); text += piece; emit({ t: "d", c: piece }); }
        // The assistant events name the model that actually answered.
        if (!pooled.actualModel && e.type === "assistant") {
          const msgModel = ((e.message ?? {}) as { model?: unknown }).model;
          if (typeof msgModel === "string" && msgModel && msgModel !== "<synthetic>") pooled.actualModel = msgModel;
        }
        // Rolling activity: tool_use blocks name the tool in flight.
        const ev = (e.event ?? {}) as Record<string, unknown>;
        if (e.type === "stream_event" && ev.type === "content_block_start") {
          const cb = (ev.content_block ?? {}) as Record<string, unknown>;
          if (cb.type === "tool_use") emit({ t: "activity", c: `đang chạy: ${String(cb.name ?? "tool")}` });
        }
        // Thinking blocks stream as thinking_delta chunks — surface the rolling
        // tail like the codex lane's reasoning deltas (absent entirely when the
        // model doesn't think out loud, which is correct, not a gap).
        if (e.type === "stream_event" && ev.type === "content_block_delta") {
          const d = (ev.delta ?? {}) as Record<string, unknown>;
          if (d.type === "thinking_delta" && typeof d.thinking === "string") {
            thinking += d.thinking;
            const tail = thinking.replace(/\s+/g, " ").trim().slice(-80);
            if (tail) emit({ t: "activity", c: `đang nghĩ: ${tail}` });
          }
        }
      };
      if (pooled.acpSessionId) sendTurn(); // warm process: reader already up
      else setTimeout(sendTurn, 10_000); // cold: init is slow; never hold forever
    } else if (lane === "codex-appserver") {
      // app-server JSON-RPC: turn ends on the turn/completed notification.
      let completedStatus: string | null = null;
      // Reasoning deltas are fragments — accumulate for a readable rolling tail.
      let reasoning = "";
      pooled.conn.onNotify = (m) => {
        const params = (m.params ?? {}) as Record<string, unknown>;
        if (m.method === "item/agentMessage/delta") {
          const d = params.delta;
          if (typeof d === "string") { firstD(); text += d; emit({ t: "d", c: d }); }
        } else if (m.method === "item/reasoning/textDelta") {
          const d = params.delta;
          if (typeof d === "string") {
            reasoning += d;
            const tail = reasoning.replace(/\s+/g, " ").trim().slice(-80);
            if (tail) emit({ t: "activity", c: `đang nghĩ: ${tail}` });
          }
        } else if (m.method === "item/commandExecution/outputDelta") {
          const d = String(params.delta ?? "").replace(/\s+/g, " ").trim();
          if (d) emit({ t: "activity", c: `đang chạy: ${d.slice(-80)}` });
        } else if (m.method === "item/mcpToolCall/progress") {
          emit({ t: "activity", c: `đang chạy: ${String(params.tool ?? "tool")}` });
        } else if (m.method === "turn/completed") {
          const turn = (params.turn ?? params) as Record<string, unknown>;
          completedStatus = String(turn.status ?? params.status ?? "completed");
        }
      };
      pooled.conn.call("turn/start", {
        threadId: pooled.acpSessionId,
        input: [
          // Verified on 0.145.0: image input is a url block ("data:<mime>;base64,…"),
          // not the ACP {data, mimeType} shape — that one is refused.
          ...(opts.images ?? []).map((img) => ({ type: "image", url: `data:${img.mimeType};base64,${img.data}` })),
          { type: "text", text: turnPrompt },
        ],
      }).then((r) => {
        if (r.error) { finish({ error: r.error.message ?? "codex turn/start failed" }); return; }
        // The result acknowledges the start; completion arrives as a notification.
        const wait = setInterval(() => {
          if (completedStatus) {
            clearInterval(wait);
            finish({ error: completedStatus === "completed" ? null : `turn ${completedStatus}` });
          }
        }, 200);
        setTimeout(() => clearInterval(wait), CHAT_TIMEOUT_MS);
      });
    } else {
      // Thought chunks arrive as tiny fragments — accumulate so the rolling
      // activity line reads as the sentence's tail, not one fragment.
      let thinking = "";
      pooled.conn.onNotify = (m) => {
        if (m.method !== "session/update") return;
        const u = (m.params as {
          update?: {
            sessionUpdate?: string;
            content?: { text?: string };
            title?: string;
            kind?: string;
            status?: string;
          };
        } | undefined)?.update;
        if (u?.sessionUpdate === "agent_message_chunk" && typeof u.content?.text === "string") {
          firstD();
          text += u.content.text;
          emit({ t: "d", c: u.content.text });
        } else if (u?.sessionUpdate === "agent_thought_chunk" && typeof u.content?.text === "string") {
          emit({ t: "thought", c: u.content.text });
          // One rolling activity line for the UI — latest thing the agent is doing.
          thinking += u.content.text;
          const tail = thinking.replace(/\s+/g, " ").trim();
          if (tail) emit({ t: "activity", c: `đang nghĩ: ${tail.slice(-80)}` });
        } else if (u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update") {
          const what = u.title ?? u.kind ?? "tool";
          emit({ t: "activity", c: u.status === "completed" ? `${what} ✓` : `đang chạy: ${what}` });
        }
      };
      pooled.conn.call("session/prompt", {
        sessionId: pooled.acpSessionId,
        prompt: [
          ...(opts.images ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType })),
          { type: "text", text: turnPrompt },
        ],
      }).then((r) => {
        if (r.error) finish({ error: r.error.message ?? "ACP prompt failed" });
        else finish({});
      });
    }

    const finish = (result: { error?: string | null }) => {
      if (settled) return;
      settled = true;
      pooled.busy = false;
      pooled.lastUsed = Date.now();
      pooled.child.removeListener("error", onChildError);
      pooled.child.removeListener("close", onChildClose);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const durationMs = Date.now() - started;
      emit({ t: "done", code: result.error ? null : 0, ms: durationMs, timedOut });
      resolve({
        text,
        exitCode: result.error ? null : 0,
        durationMs,
        timedOut,
        error: result.error ?? (timedOut ? `Timed out after ${Math.round(CHAT_TIMEOUT_MS / 1000)}s.` : null),
        sessionId: pooled.acpSessionId,
        actualModel: pooled.actualModel,
        ttfbMs: ttfb,
        usage: null,
        protocolError: null,
        aborted: false,
      });
    };

    const stop = (why: string) => {
      pooled.dead = true;
      killTree(pooled.child);
      finish({ error: why });
    };
    const onAbort = () => stop("Stopped — the page went away.");
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      stop(`Timed out after ${Math.round(CHAT_TIMEOUT_MS / 1000)}s.`);
    }, CHAT_TIMEOUT_MS);
  });
}

/** Drop every pooled process (tests, shutdown). */
export function drainAcpPool(): void {
  for (const [, p] of pool) killTree(p.child);
  pool.clear();
}
