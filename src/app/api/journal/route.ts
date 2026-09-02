import { NextResponse } from "next/server";
import {
  VAULT_AVAILABLE,
  todayISO,
  readJournal,
  appendJournalEntry,
  listJournalDays,
} from "@/lib/vaultWriter";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_VAULT =
  "Connect your Obsidian vault to use Journal — entries are saved to Agentic OS/Journal/YYYY-MM-DD.md. See install/11-MEMORY-OBSIDIAN.md.";

function noVault() {
  return NextResponse.json({ error: NO_VAULT, vault: false }, { status: 503 });
}

function failed(e: unknown) {
  return NextResponse.json({ error: `Could not reach your vault: ${String(e)}`, vault: true }, { status: 500 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!VAULT_AVAILABLE) {
    return NextResponse.json({ days: [], entries: [], date: todayISO(), vault: false, error: NO_VAULT });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : todayISO();

  try {
    const [days, entries] = await Promise.all([listJournalDays(30), readJournal(date)]);
    return NextResponse.json({ days, entries, date, vault: true });
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!VAULT_AVAILABLE) return noVault();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const text = String(body.text ?? "").slice(0, 4000).trim();
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });

  const dateRaw = body.date ? String(body.date).slice(0, 10) : todayISO();
  if (!DATE_RE.test(dateRaw)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await appendJournalEntry(dateRaw, text);
    const entries = await readJournal(dateRaw);
    const days = await listJournalDays(30);
    return NextResponse.json({ ok: true, path: result.path, date: dateRaw, entries, days });
  } catch (e) {
    return failed(e);
  }
}
