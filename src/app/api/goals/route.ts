import { NextResponse } from "next/server";
import { readGoals, writeGoals, VAULT_AVAILABLE, type Goal } from "@/lib/vaultWriter";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newId(): string { return Math.random().toString(36).slice(2, 10); }

// Goals live in Agentic OS/Goals.md inside the vault, so with no vault there is
// nowhere to read or write. Say so instead of letting the fs call throw — an
// unhandled throw here reaches the browser as an empty 500 the UI cannot explain.
const NO_VAULT = "Connect your Obsidian vault to use Goals — they are saved to Agentic OS/Goals.md. See install/11-MEMORY-OBSIDIAN.md.";

function noVault() {
  return NextResponse.json({ error: NO_VAULT, vault: false }, { status: 503 });
}

function failed(e: unknown) {
  return NextResponse.json({ error: `Could not reach your vault: ${String(e)}`, vault: true }, { status: 500 });
}

export async function GET() {
  if (!VAULT_AVAILABLE) return NextResponse.json({ goals: [], vault: false, error: NO_VAULT });
  try {
    return NextResponse.json({ goals: await readGoals(), vault: true });
  } catch (e) { return failed(e); }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!VAULT_AVAILABLE) return noVault();
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const text = String(body.text ?? "").slice(0, 500).trim();
  const category = body.category ? String(body.category).slice(0, 30).trim() : undefined;
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  try {
    const goals = await readGoals();
    const goal: Goal = {
      id: newId(),
      text, category,
      done: false,
      createdAt: new Date().toISOString(),
    };
    goals.unshift(goal);
    await writeGoals(goals);
    return NextResponse.json({ goal, total: goals.length });
  } catch (e) { return failed(e); }
}

export async function PATCH(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!VAULT_AVAILABLE) return noVault();
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const id = String(body.id ?? "");
  try {
    const goals = await readGoals();
    const g = goals.find((x) => x.id === id);
    if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (typeof body.done === "boolean") g.done = body.done;
    if (typeof body.text === "string" && body.text.trim()) g.text = body.text.slice(0, 500).trim();
    if (typeof body.category === "string") g.category = body.category.slice(0, 30).trim() || undefined;
    await writeGoals(goals);
    return NextResponse.json({ goal: g });
  } catch (e) { return failed(e); }
}

export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!VAULT_AVAILABLE) return noVault();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const goals = await readGoals();
    const next = goals.filter((g) => g.id !== id);
    await writeGoals(next);
    return NextResponse.json({ ok: true, total: next.length });
  } catch (e) { return failed(e); }
}
