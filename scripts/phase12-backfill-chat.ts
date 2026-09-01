/**
 * One-shot backfill of FirstMate transcript JSONL into the sen-plane product
 * store. There is no direct SQLite path: every turn is written through the
 * daemon's fixed chat contract.
 *
 *   POST /api/v1/sen/chat  {session_id, sender, text}
 *     -> 200 {command_id, turn_seq, session_id, created_at}
 *
 * JSONL record shape (FirstMate): {"role":"user"|"assistant"|"system","text":"...","ts":"RFC3339"}
 * Each chat.jsonl becomes one session; the session id is the transcript's
 * parent directory name (e.g. firstmate-s-ms3a3eih-9m6a6), so a re-run
 * addresses the same sessions. Turns are posted in file order to keep
 * turn_seq monotonic per session.
 *
 *   npx tsx scripts/phase12-backfill-chat.ts <sourcePath> [--dry-run] [--base <url>]
 *
 *   sourcePath directory to scan recursively for chat.jsonl, or one transcript file
 *   --dry-run  count only; prints the plan and never writes
 *   --base     daemon base URL (default: $SEN_DAEMON_URL or http://127.0.0.1:3979)
 *
 * The contract carries no timestamp, so the original transcript `ts` is not
 * preserved; recorded_at is the daemon's received time. Run once per
 * transcript — the contract has no idempotency key, a second run duplicates
 * turns.
 *
 * Dry-run is always safe; a real run writes into the daemon's product store
 * (%LOCALAPPDATA%\NEWSOS\sen-plane\store\sen-product.db by default).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve, join, sep } from "node:path";

interface ChatRecord {
  role: "user" | "assistant" | "system";
  text: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a) => !a.startsWith("--"));
const sourcePath = resolve(positional[0] ?? ".");
const dryRun = args.includes("--dry-run");
const base = (flag("--base") ?? process.env.SEN_DAEMON_URL ?? "http://127.0.0.1:3979").replace(/\/+$/, "");

function findTranscripts(path: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name === "chat.jsonl") files.push(join(path, entry.name));
    } else if (entry.isDirectory()) {
      files.push(...findTranscripts(join(path, entry.name)));
    }
  }
  return files;
}

/** Session id from the transcript's parent dir name, which identifies the agent session. */
function sessionIdFor(file: string): string {
  const parent = dirname(file).split(sep).filter(Boolean).pop() ?? basename(dirname(file));
  return parent.replace(/[\s/\\]+/g, "-").slice(0, 120);
}

function readRecords(file: string): { records: ChatRecord[]; skipped: number } {
  const records: ChatRecord[] = [];
  let skipped = 0;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch (e) {
      skipped++;
      console.warn(`  warn: ${basename(file)}:${i + 1}: bad JSON (${e instanceof Error ? e.message : e}); skipped`);
      continue;
    }
    const obj = rec as { role?: unknown; text?: unknown };
    const role = obj.role;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      skipped++;
      console.warn(`  warn: ${basename(file)}:${i + 1}: role ${JSON.stringify(role)} not user/assistant/system; skipped`);
      continue;
    }
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) {
      skipped++;
      continue;
    }
    records.push({ role, text });
  }
  return { records, skipped };
}

async function postTurn(sessionId: string, record: ChatRecord): Promise<number> {
  const res = await fetch(`${base}/api/v1/sen/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, sender: record.role, text: record.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`POST ${base}/api/v1/sen/chat -> ${res.status} ${snippet}`);
  }
  const body = (await res.json()) as { turn_seq?: number };
  return typeof body.turn_seq === "number" ? body.turn_seq : 0;
}

async function main(): Promise<void> {
  let transcript: string[] = [];
  try {
    transcript = statSync(sourcePath).isFile() ? [sourcePath] : findTranscripts(sourcePath).sort();
  } catch {
    throw new Error(`cannot read source path ${sourcePath}`);
  }
  if (transcript.length === 0) throw new Error(`no chat.jsonl transcripts under ${sourcePath}`);

  const plan: { file: string; sessionId: string; records: ChatRecord[]; skipped: number }[] = [];
  let totalTurns = 0;
  let totalSkipped = 0;
  for (const file of transcript) {
    const sessionId = sessionIdFor(file);
    const { records, skipped } = readRecords(file);
    totalSkipped += skipped;
    if (records.length === 0) {
      console.warn(`warn: ${basename(file)} -> session ${sessionId}: no readable turns; skipped`);
      continue;
    }
    plan.push({ file, sessionId, records, skipped });
    totalTurns += records.length;
  }

  console.log(`reading ${sourcePath}`);
  console.log(`daemon: ${base}`);
  for (const p of plan) {
    console.log(`  ${p.sessionId}: ${p.records.length} turns (${basename(p.file)})`);
  }
  console.log(`plan: ${plan.length} transcripts, ${totalTurns} turns` + (totalSkipped ? `, ${totalSkipped} skipped` : ""));

  if (dryRun) {
    console.log("dry-run: nothing was written.");
    return;
  }

  const probe = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5_000) });
  if (!probe.ok) {
    throw new Error(`sen-plane daemon not healthy at ${base} (GET /healthz -> ${probe.status}); start it with scripts/dev-sen-plane.ps1`);
  }

  const startedAt = Date.now();
  let written = 0;
  for (const p of plan) {
    for (const record of p.records) {
      await postTurn(p.sessionId, record);
      written++;
      if (written % 25 === 0) process.stdout.write(`\r  wrote ${written}`);
    }
  }
  process.stdout.write(`\r  wrote ${written}`);
  process.stdout.write("\n");
  console.log(`done: ${plan.length} transcripts, ${written} turns into ${base} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});