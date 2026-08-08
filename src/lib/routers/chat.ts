// One chat turn against one Router profile.
//
// The Builder runner spawns a process; this one drives an HTTP adapter. What
// they share is the event protocol, because the same chat view renders both:
// the client cannot tell whether the words came from a CLI on this machine or
// from a gateway across the internet, and it should not have to.
//
// One real difference is worth stating. The CLIs take a single prompt string,
// so builders/history.ts has to fold prior turns into the text and admit what
// it dropped. An HTTP endpoint takes a message array, so history here is sent
// as history — the model sees turns, not a transcript pasted into a prompt.
//
// This file is a facade. It owns the things that are true for every provider —
// the timeout, the history budget, the event protocol, the wording of every
// failure — and the adapter (see adapters/) owns the wire: URL, headers,
// request shape, stream parsing. A chunk arrives normalized and the facade
// only has to decide which event it becomes.

import { routerKind, type Router } from "./registry";
import type { Turn } from "../builders/history";
import { getAdapter } from "./adapters";
import { AdapterHttpError, type ChatMessage, type ChatRequest } from "./adapters/base";

/** A turn should not hang a page forever; shares the Builder chat's override. */
export const ROUTER_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.AGENTIC_OS_CHAT_TIMEOUT_MS) || 5 * 60_000,
);

/**
 * How much history to send. Endpoints bill by token, so both limits are real:
 * twenty turns of a pasted file is not a small request, and a turn count alone
 * would let one large answer sit in the window forever, re-billed every turn.
 */
const HISTORY_TURNS = 20;
const HISTORY_CHARS = 12_000;

export type RouterChatEvent =
  | { t: "d"; c: string }
  | { t: "note"; c: string }
  | { t: "done"; code: number | null; ms: number; timedOut: boolean }
  | { t: "error"; m: string };

export interface RouterChatResult {
  text: string;
  /** HTTP status, or null when the request never got an answer. */
  status: number | null;
  durationMs: number;
  timedOut: boolean;
  error: string | null;
}

export interface RouterChatOptions {
  router: Router;
  prompt: string;
  history?: Turn[];
  /** The agent's own model choice, which beats the Router's default. */
  model?: string | null;
  system?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  emit: (e: RouterChatEvent) => void;
}

function buildMessages(opts: RouterChatOptions): { messages: ChatMessage[]; dropped: number } {
  const msgs: ChatMessage[] = [];
  if (opts.system?.trim()) msgs.push({ role: "system", content: opts.system.trim() });

  const turns = (opts.history ?? []).filter((t) => t.text.trim());

  // A turn the endpoint never answered leaves a user message with no reply. Sent
  // back as-is those stack up into consecutive user messages, which several
  // gateways reject outright — and the prompt below already says the same thing.
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();

  // Oldest falls off first: the turn being answered needs the turns nearest it.
  const recent = turns.slice(-HISTORY_TURNS);
  const kept: Turn[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    chars += recent[i].text.length;
    // Always keep one, however large — a window of nothing is worse than a
    // window over budget, and the endpoint's own error is clearer than ours.
    if (chars > HISTORY_CHARS && kept.length) break;
    kept.unshift(recent[i]);
  }

  for (const t of kept) msgs.push({ role: t.role, content: t.text });
  msgs.push({ role: "user", content: opts.prompt });
  return { messages: msgs, dropped: turns.length - kept.length };
}

export async function runRouterChat(opts: RouterChatOptions): Promise<RouterChatResult> {
  const { router, emit } = opts;
  const timeoutMs = opts.timeoutMs ?? ROUTER_TIMEOUT_MS;
  const started = Date.now();
  const fail = (m: string, status: number | null = null): RouterChatResult => {
    emit({ t: "error", m });
    emit({ t: "done", code: status, ms: Date.now() - started, timedOut: false });
    return { text: "", status, durationMs: Date.now() - started, timedOut: false, error: m };
  };

  const model = (opts.model ?? router.defaultModel ?? "").trim();
  if (!model) {
    // Nearly every gateway rejects a request with no model, and the 400 it sends
    // back reads like the key is wrong. Saying it here names the actual fix.
    return fail(
      `${router.name} has no default model, and this agent does not name one. `
      + `Set a default model on the Router — the endpoint will not guess.`,
    );
  }

  const adapterId = routerKind(router.kind)?.adapter ?? "openai-compatible";
  const adapter = getAdapter(adapterId);
  if (!adapter) {
    // Only a hand-edited routers.json can land here; the fix is on disk, not
    // in any form the dashboard renders.
    return fail(`The Router kind "${router.kind}" names chat adapter "${adapterId}", which is not registered.`);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  const { messages, dropped } = buildMessages(opts);
  if (dropped > 0) {
    emit({
      t: "note",
      c: `${dropped} older turn${dropped === 1 ? " was" : "s were"} left out of this request to stay within the history budget.`,
    });
  }

  const req: ChatRequest = {
    router,
    model,
    messages,
    signal: controller.signal,
    meta: { status: null },
  };

  let text = "";
  // A mid-stream error: the endpoint said 200, sent some words, then failed.
  // It is a failed turn, not a remark — reported as a note, the turn would
  // claim success and file a truncated answer as the whole reply.
  let streamError: string | null = null;
  try {
    for await (const chunk of adapter.stream(req)) {
      if (chunk.error) {
        streamError = chunk.error;
        emit({ t: "error", m: streamError });
        continue;
      }
      if (chunk.deltaText) { text += chunk.deltaText; emit({ t: "d", c: chunk.deltaText }); }
    }

    if (!text && !streamError) {
      emit({ t: "note", c: `${router.name} answered, but the reply carried no text.` });
    }

    const durationMs = Date.now() - started;
    emit({ t: "done", code: req.meta.status, ms: durationMs, timedOut: false });
    return { text, status: req.meta.status, durationMs, timedOut: false, error: streamError };
  } catch (e) {
    const durationMs = Date.now() - started;
    if (timedOut) {
      const m = `${router.name} did not finish within ${Math.round(timeoutMs / 1000)}s.`;
      emit({ t: "error", m });
      emit({ t: "done", code: null, ms: durationMs, timedOut: true });
      return { text, status: null, durationMs, timedOut: true, error: m };
    }
    // The page going away is the user walking off mid-answer, not a fault.
    if (opts.signal?.aborted) {
      emit({ t: "done", code: null, ms: durationMs, timedOut: false });
      return { text, status: null, durationMs, timedOut: false, error: null };
    }
    if (e instanceof AdapterHttpError) {
      if (!e.detail) return fail(`${router.name} answered with no body.`, e.status);
      const hint = e.status === 401 || e.status === 403
        ? ` Check the key on this Router — ${router.name} rejected it.`
        : "";
      return fail(`${e.status} from ${router.name}: ${e.detail}${hint}`, e.status);
    }
    return fail(`Could not reach ${router.name} at ${router.baseUrl}: ${String((e as Error)?.message ?? e)}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    // `data: [DONE]` leaves the body unfinished and the socket assigned to a
    // request nobody will read again. Aborting after a completed turn costs
    // nothing; not aborting leaks one connection per turn.
    controller.abort();
  }
}
