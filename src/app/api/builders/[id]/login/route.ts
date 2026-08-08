import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkLocalRequest } from "@/lib/localOnly";
import { getBuilder } from "@/lib/builders/registry";
import { resolveBuilderSpawn, BuilderSpawnError } from "@/lib/builders/spawn";
import { agentEnv } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opening a login terminal for a profile.
//
// The dashboard never types your credentials. All this does is open a console
// with the profile's isolation variable already set, so whatever you log into
// there belongs to this profile and not to the CLI's shared account. The exact
// command is always returned as well — if the window does not appear (or you are
// on a remote/headless session), pasting it yourself does the identical thing.

function quoteForCmd(s: string): string {
  return /[\s&|<>^"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function quoteForShell(s: string): string {
  return /[^\w@%+=:,./-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const b = await getBuilder(id);
  if (!b) return NextResponse.json({ error: `No profile "${id}".` }, { status: 404 });

  let resolved;
  try { resolved = resolveBuilderSpawn(b); }
  catch (e) {
    return NextResponse.json(
      { error: e instanceof BuilderSpawnError ? e.message : String(e) },
      { status: 400 },
    );
  }

  const { spec, binOverride, extraEnv } = resolved;
  if (!spec.loginArgs) {
    return NextResponse.json(
      { error: `${spec.label} has no login command Agent OS knows about. Log in the way you normally would; set this profile's isolation variable first so the session lands in its own directory.` },
      { status: 400 },
    );
  }

  const bin = binOverride!;
  const isWindows = process.platform === "win32";

  const envLines = Object.entries(extraEnv).map(([k, v]) =>
    isWindows ? `set "${k}=${v}"` : `export ${k}=${quoteForShell(v)}`);
  const runLine = isWindows
    ? [bin, ...spec.loginArgs].map(quoteForCmd).join(" ")
    : [bin, ...spec.loginArgs].map(quoteForShell).join(" ");
  const command = [...envLines, runLine].join(isWindows ? " && " : "\n");

  let opened = false;
  let openError: string | null = null;

  if (isWindows) {
    // `start` gives the login its own console with a real TTY — an OAuth flow
    // needs one. The new console inherits this env, which is how the profile's
    // isolation variable reaches it. windowsVerbatimArguments because cmd does
    // its own quoting and Node's escaping fights it.
    const inner = `${runLine}`;
    const line = `start "Agent OS - ${spec.label} login" cmd /k "${inner}"`;
    try {
      const child = spawn("cmd.exe", ["/c", line], {
        env: agentEnv(extraEnv),
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      });
      child.unref();
      opened = true;
    } catch (e) { openError = String(e instanceof Error ? e.message : e); }
  } else {
    openError = "Opening a terminal automatically is only wired up on Windows. Run the command below yourself.";
  }

  return NextResponse.json({
    opened,
    openError,
    command,
    env: extraEnv,
    // Worth stating plainly: a profile without an isolation variable cannot have
    // its own account, so logging in there changes the CLI's shared login.
    isolated: Boolean(spec.isolationEnv && b.auth.configDir),
    note: spec.isolationEnv && b.auth.configDir
      ? `This login is stored under ${b.auth.configDir}, separate from your other ${spec.label} accounts.`
      : `${spec.label} has no verified per-profile login on this machine, so this signs in the CLI's shared account.`,
  });
}
