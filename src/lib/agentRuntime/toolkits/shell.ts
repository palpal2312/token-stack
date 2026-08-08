// Shell tools: run an allowlisted executable with the working directory
// jailed to the root, a 60s timeout, and a hard cap on captured output.
//
// This toolkit is the runtime's blast radius, so the mitigations are the
// design, not add-ons:
//
//   * Allowlist on the executable NAME, checked before spawn. A command not
//     on the list is refused as the tool's result — the model reads the no
//     and picks an allowed tool instead of the run dying.
//   * No shell: spawn(executable, args) directly. Without a shell there is
//     no &&, no pipes, no redirection — "echo hi > /etc/x" is five literal
//     arguments to echo, not a write. (It also means cmd builtins like dir
//     on Windows are allowlist entries the OS may still not find; the
//     resulting ENOENT arrives as an ordinary tool error.)
//   * cwd must jail inside the root, same jailPath as the file tools.
//   * Time and output are boxed: 60s wall clock, maxBuffer of captured
//     stdout+stderr, kill past either.
//
// There is no "unrestricted" mode. Callers narrow the default list; nothing
// widens it to everything.

import { spawn } from "node:child_process";
import path from "node:path";
import type { RuntimeTool } from "../agent";
import { jailPath } from "./files";

export const DEFAULT_SHELL_ALLOW = ["node", "npm", "npx", "git", "python", "dir", "type", "echo"];
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 512 * 1024;

export interface ShellToolkitOptions {
  /** Executable names allowed to run. Defaults to DEFAULT_SHELL_ALLOW. */
  allow?: string[];
  timeoutMs?: number;
  maxBuffer?: number;
}

/** The name the allowlist judges: basename, lowercase, no extension. */
function exeName(command: string): string {
  return path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

export function shellToolkit(root: string, opts: ShellToolkitOptions = {}): RuntimeTool[] {
  const allow = new Set((opts.allow ?? DEFAULT_SHELL_ALLOW).map((n) => n.toLowerCase()));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;

  return [
    {
      name: "shell_run",
      description:
        `Run an allowed command (${[...allow].join(", ")}) with cwd inside ${root}. `
        + `No shell features — no pipes, &&, or redirection. Killed after ${Math.round(timeoutMs / 1000)}s.`,
      schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The executable to run." },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string", description: "Working directory, relative to the root." },
        },
        required: ["command"],
      },
      metadata: { riskLevel: "external" },
      async execute(args) {
        const a = args as Record<string, unknown>;
        const command = typeof a?.command === "string" ? a.command.trim() : "";
        if (!command) throw new Error("Give a command to run.");
        const exe = exeName(command);
        if (!allow.has(exe)) {
          throw new Error(
            `"${exe}" is not on this agent's command allowlist (${[...allow].join(", ")}). `
            + `Use an allowed command, or a files_/git_ tool — the allowlist is the whole mitigation and it does not move mid-run.`,
          );
        }
        const argv = Array.isArray(a?.args) ? a.args.map(String) : [];
        const cwdRel = typeof a?.cwd === "string" && a.cwd ? a.cwd : ".";
        const cwd = await jailPath(root, cwdRel);

        return await new Promise((resolve) => {
          let stdout = "";
          let stderr = "";
          let overflow = false;
          const child = spawn(command, argv, { cwd, windowsHide: true });
          const killer = setTimeout(() => {
            child.kill();
            resolve({
              error: `"${exe}" did not finish within ${Math.round(timeoutMs / 1000)}s and was killed.`,
              stdout, stderr,
            });
          }, timeoutMs);
          const cap = (chunk: Buffer, into: "stdout" | "stderr") => {
            if (into === "stdout") stdout += chunk.toString("utf8");
            else stderr += chunk.toString("utf8");
            if (!overflow && stdout.length + stderr.length > maxBuffer) {
              overflow = true;
              child.kill();
              resolve({ error: `"${exe}" produced more output than the ${maxBuffer}-byte cap and was killed.`, stdout, stderr });
            }
          };
          child.stdout.on("data", (c: Buffer) => cap(c, "stdout"));
          child.stderr.on("data", (c: Buffer) => cap(c, "stderr"));
          child.on("error", (e) => {
            clearTimeout(killer);
            resolve({ error: `"${command}" could not be started: ${e.message}`, stdout, stderr });
          });
          child.on("close", (code) => {
            clearTimeout(killer);
            if (overflow) return; // already resolved at the cap
            resolve({ code: code ?? -1, stdout, stderr });
          });
        });
      },
    },
  ];
}
