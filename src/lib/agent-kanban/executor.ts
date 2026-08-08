import { getBuilder } from "@/lib/builders/registry";
import { CHAT_TIMEOUT_MS, runBuilderChat, type ChatEvent } from "@/lib/builders/chat";
import type { KanbanRole } from "./types";

export class KanbanExecutorError extends Error {
  constructor(message: string, public readonly status: 409 | 502 = 502) { super(message); }
}

export async function runKanbanBuilder(
  builderId: string,
  role: KanbanRole,
  system: string,
  prompt: string,
  opts: { cwd?: string; signal?: AbortSignal; emit?: (event: ChatEvent) => void } = {},
): Promise<{ text: string; model: string; effort: string | null }> {
  const builder = await getBuilder(builderId);
  if (!builder) throw new KanbanExecutorError(`No Builder profile "${builderId}".`, 409);
  if (!builder.verifiedAt) {
    throw new KanbanExecutorError(
      `Builder "${builder.name}" is not verified. Probe it in CLI Config before assigning the ${role} role.`,
      409,
    );
  }
  const fullPrompt = `[KANBAN ROLE: ${role.toUpperCase()}]\n${system}\n\n${prompt}`;
  const result = await runBuilderChat({
    builder,
    prompt: fullPrompt,
    cwd: opts.cwd,
    signal: opts.signal,
    timeoutMs: CHAT_TIMEOUT_MS,
    emit: opts.emit ?? (() => {}),
  });
  if (result.error || !result.text.trim()) {
    throw new KanbanExecutorError(
      result.error ?? `${builder.name} returned no usable ${role} output.`,
      502,
    );
  }
  return {
    text: result.text,
    model: result.actualModel ?? builder.model ?? builder.name,
    effort: builder.effort ?? null,
  };
}

export function parsePlannerOutput(raw: string): { title: string; brief: string }[] {
  const candidates = [
    raw.trim(),
    raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? "",
    raw.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { cards?: { title?: unknown; brief?: unknown }[] };
      const cards = (parsed.cards ?? [])
        .filter((card) => card && typeof card.title === "string")
        .slice(0, 8)
        .map((card) => ({
          title: String(card.title).trim().slice(0, 80),
          brief: String(card.brief ?? "").trim().slice(0, 1_000),
        }))
        .filter((card) => card.title);
      if (cards.length) return cards;
    } catch { /* try the next extraction */ }
  }
  return [];
}

export function extractHtmlOutput(raw: string): string | null {
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = raw.search(/<!doctype html|<html|<body|<div/i);
  if (start >= 0) return raw.slice(start).trim();
  return null;
}

