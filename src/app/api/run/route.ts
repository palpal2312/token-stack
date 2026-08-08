import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { run, validateFlagArgs, type AgentName } from "@/lib/runner";
import { ptyRun } from "@/lib/builders/ptySpawn";
import { cliSpec, defaultBinFor } from "@/lib/builders/clis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Record<AgentName, RegExp[]> = {
  claude: [
    /^--version$/, /^--help$/,
    /^-p$/, /^--output-format=stream-json$/, /^--include-partial-messages$/,
    /^--verbose$/, /^--print$/, /^--continue$/,
  ],
  openclaw: [
    /^health$/, /^doctor$/, /^logs$/, /^memory$/,
    /^agents$/, /^list$/, /^status$/,
    /^cron$/, /^channels$/, /^gateway$/, /^chat$/,
    /^--help$/, /^--version$/,
  ],
  hermes: [
    /^status$/, /^doctor$/, /^sessions$/, /^insights$/, /^kanban$/,
    /^skills$/, /^plugins$/, /^list$/, /^logs$/, /^memory$/,
    /^--help$/, /^--version$/,
  ],
  antigravity: [
    /^--version$/, /^--help$/, /^status$/,
  ],
  fcc: [
    // fcc is the same `claude` CLI — same allowlist + --bare for forced env auth
    /^--version$/, /^--help$/, /^--bare$/,
    /^-p$/, /^--output-format=stream-json$/, /^--include-partial-messages$/,
    /^--verbose$/, /^--print$/, /^--continue$/,
  ],
  codex: [
    /^--version$/, /^--help$/, /^exec$/, /^--json$/, /^--full-auto$/,
    /^--skip-git-repo-check$/, /^--last$/, /^resume$/, /^review$/,
    /^--model$/, /^-m$/, /^-c$/, /^-i$/, /^--image$/,
    /^[A-Za-z0-9._=:-]+$/, // permissive token for -c key=value style overrides + model names
  ],
  ruflo: [
    /^--version$/, /^--help$/, /^status$/, /^swarm$/, /^agent$/, /^init$/, /^start$/,
    /^spawn$/, /^list$/, /^--json$/, /^--topology$/, /^--max-agents$/, /^--parallel$/,
    /^-t$/, /^-n$/, /^-o$/, /^--task$/, /^--timeout$/, /^--monitor$/,
    /^[A-Za-z0-9._:\- ]+$/, // permissive token for names, objectives, types
  ],
  ant: [
    // Claude Platform CLI (`ant`) — read-only/diagnostic flags only.
    /^--version$/, /^--help$/, /^auth$/, /^status$/, /^models$/, /^files$/,
    /^list$/, /^beta:agents$/, /^--output$/, /^json$/, /^yaml$/,
  ],
  kimi: [
    // Kimi Code (K2.7) — diagnostic/read-only flags only here; chat runs via /api/kimi/chat.
    /^--version$/, /^-V$/, /^--help$/, /^-h$/, /^doctor$/,
  ],
  grok: [
    // Grok Build CLI (xAI grok-build) — diagnostic/read-only flags only; chat runs via its own route.
    /^--version$/, /^-v$/, /^--help$/, /^-h$/,
  ],
};

function safe(agent: AgentName, args: string[]) {
  // /api/run only accepts allowlisted flag-shaped args (no free-form prompts here).
  const filtered = validateFlagArgs(args);
  if (filtered.length !== args.length) return false;
  const patterns = ALLOWED[agent];
  return args.every((a) => patterns.some((re) => re.test(a)));
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const agent = body.agent as AgentName;
  const args: string[] = Array.isArray(body.args) ? body.args : [];
  if (!["claude", "openclaw", "hermes", "antigravity"].includes(agent)) {
    return NextResponse.json({ error: "bad agent" }, { status: 400 });
  }
  if (!safe(agent, args)) {
    return NextResponse.json({ error: "command not allowlisted", agent, args }, { status: 403 });
  }
  // agy.exe exits silently on a plain pipe — it needs the PTY lane, same as
  // the chat and vitals paths.
  const out = agent === "antigravity"
    ? await (async () => {
        const spec = cliSpec("antigravity");
        const bin = spec ? defaultBinFor(spec) : null;
        if (!bin) return { ok: false, code: null, stdout: "", stderr: "agy.exe not found at the default path.", durationMs: 0 };
        return ptyRun(bin, args, { timeoutMs: 15000 });
      })()
    : await run(agent, args, { timeoutMs: 15000 });
  return NextResponse.json({ agent, args, ...out });
}
