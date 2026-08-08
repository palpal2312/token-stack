// Git tools: status, diff, log — read-only by construction. There is no
// commit tool on purpose: the runtime's git toolkit answers "what changed"
// for an agent that is about to edit or report, and handing a model the
// ability to rewrite history is a decision for a human with a terminal.
//
// git is spawned with an argv array, never through a shell, so a crafted
// branch or path name is data to git, not syntax to cmd. The repo is the
// jail root; any path argument goes through the same jailPath the file
// tools use, and the process is killed at 30s because a wedged repo or a
// credential prompt must not hang a run.

import { spawn } from "node:child_process";
import type { RuntimeTool } from "../agent";
import { jailPath } from "./files";

const GIT_TIMEOUT_MS = 30_000;
const MAX_LOG = 100;

interface GitOut { code: number; stdout: string; stderr: string }

function git(root: string, args: string[]): Promise<GitOut> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const killer = setTimeout(() => {
      child.kill();
      reject(new Error(`git ${args[0]} did not answer within 30s and was killed.`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => {
      clearTimeout(killer);
      reject(new Error(`git could not be started: ${e.message}. Is git installed and on PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function asResult(out: GitOut): unknown {
  if (out.code !== 0) return { error: out.stderr.trim() || `git exited ${out.code}` };
  return { output: out.stdout };
}

export function gitToolkit(root: string): RuntimeTool[] {
  return [
    {
      name: "git_status",
      description: `Working-tree status of the repository at ${root}.`,
      schema: { type: "object", properties: {} },
      metadata: { riskLevel: "read" },
      async execute() {
        return asResult(await git(root, ["status"]));
      },
    },
    {
      name: "git_diff",
      description: `Unstaged diff of the repository at ${root}, optionally limited to one path.`,
      schema: {
        type: "object",
        properties: { path: { type: "string", description: "Limit the diff to this path, relative to the root." } },
      },
      metadata: { riskLevel: "read" },
      async execute(args) {
        const p = (args as Record<string, unknown>)?.path;
        const argv = ["diff", "--"];
        if (typeof p === "string" && p) {
          // The jail check runs even though git is cwd-pinned: a path that
          // escapes the root is a signal the model is lost, and saying so is
          // kinder than diffing a neighbour directory it never meant to touch.
          await jailPath(root, p);
          argv.push(p);
        }
        return asResult(await git(root, argv));
      },
    },
    {
      name: "git_log",
      description: `Recent commits of the repository at ${root}, one line each.`,
      schema: {
        type: "object",
        properties: { limit: { type: "number", description: `How many commits, at most ${MAX_LOG}.` } },
      },
      metadata: { riskLevel: "read" },
      async execute(args) {
        const raw = (args as Record<string, unknown>)?.limit;
        const limit = typeof raw === "number" && Number.isFinite(raw)
          ? Math.max(1, Math.min(MAX_LOG, Math.floor(raw)))
          : 20;
        return asResult(await git(root, ["log", "--oneline", `-${limit}`]));
      },
    },
  ];
}
