// File tools, jailed to one root directory. The jail is the whole safety
// story here: every path the model proposes is resolved against the root,
// symlinks are followed to their real location, and anything that lands
// outside is refused before a byte is read or written.
//
// The symlink check matters because a plain path.resolve is not enough:
// root/link -> /etc makes "link/passwd" resolve inside the root on paper
// while reading outside it. realpath on the deepest existing ancestor closes
// that, and works for files that do not exist yet (writes).
//
// Rejections are phrased as next steps, the same voice as sanitizeEnv's
// rejections: the refusal is the tool's result, the model reads it, and it
// can pick a path inside the root instead of the run dying.

import { readFile, writeFile, readdir, realpath, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { RuntimeTool } from "../agent";

/** Reads are capped so one tool result cannot flood the model's context. */
const READ_CAP = 100 * 1024;
const LIST_CAP = 500;

/**
 * Resolve `rel` inside `root`, following symlinks, and refuse anything that
 * escapes. Returns the absolute path to use. Shared with the git and shell
 * toolkits — one jail, three doors.
 */
export async function jailPath(root: string, rel: string): Promise<string> {
  const abs = path.resolve(root, rel);
  const rootReal = await realpath(root);

  // Find the deepest ancestor that exists and resolve it for real; the
  // not-yet-existing tail cannot contain a symlink because it is not there.
  const missing: string[] = [];
  let cursor = abs;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.push(path.basename(cursor));
    cursor = parent;
  }
  const realAncestor = await realpath(cursor);
  const real = missing.length ? path.join(realAncestor, ...missing.reverse()) : realAncestor;

  const relToRoot = path.relative(rootReal, real);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error(
      `"${rel}" lands outside this agent's root (${root}). Pick a path inside the root — the jail is what keeps the agent's hands off the rest of this machine.`,
    );
  }
  return abs;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new Error(`Give ${name} as a string.`);
  return v;
}

export function filesToolkit(root: string): RuntimeTool[] {
  return [
    {
      name: "files_read",
      description: `Read a file inside ${root}. Returns { content, truncated }.`,
      schema: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the root." } },
        required: ["path"],
      },
      metadata: { riskLevel: "read" },
      async execute(args) {
        const p = str((args as Record<string, unknown>)?.path, "path");
        const abs = await jailPath(root, p);
        const buf = await readFile(abs);
        const truncated = buf.length > READ_CAP;
        return { content: buf.subarray(0, READ_CAP).toString("utf8"), truncated };
      },
    },
    {
      name: "files_write",
      description: `Write a file inside ${root}, creating parent directories. Overwrites.`,
      schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the root." },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      metadata: { riskLevel: "write" },
      async execute(args) {
        const p = str((args as Record<string, unknown>)?.path, "path");
        const content = str((args as Record<string, unknown>)?.content, "content");
        const abs = await jailPath(root, p);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return { path: p, bytes: Buffer.byteLength(content) };
      },
    },
    {
      name: "files_list",
      description: `List a directory inside ${root}. Defaults to the root itself.`,
      schema: {
        type: "object",
        properties: { path: { type: "string", description: "Directory relative to the root." } },
      },
      metadata: { riskLevel: "read" },
      async execute(args) {
        const p = (args as Record<string, unknown>)?.path;
        const abs = await jailPath(root, typeof p === "string" && p ? p : ".");
        const entries = await readdir(abs, { withFileTypes: true });
        const listed = entries.slice(0, LIST_CAP).map((e) => ({
          name: e.name,
          kind: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "symlink" : "file",
        }));
        return { entries: listed, truncated: entries.length > LIST_CAP };
      },
    },
    {
      name: "files_edit",
      description: `Replace text in a file inside ${root}. Fails when the find text is absent — read the file first.`,
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" },
          replaceAll: { type: "boolean", description: "Replace every occurrence, not just the first." },
        },
        required: ["path", "find", "replace"],
      },
      metadata: { riskLevel: "write" },
      async execute(args) {
        const a = args as Record<string, unknown>;
        const p = str(a?.path, "path");
        const find = str(a?.find, "find");
        const replace = typeof a?.replace === "string" ? a.replace : (() => { throw new Error("Give replace as a string."); })();
        const abs = await jailPath(root, p);
        const text = await readFile(abs, "utf8");
        if (!text.includes(find)) {
          throw new Error(
            `The find text is not in ${p}. Read the file and copy the exact text to replace — guessing edits is how files get mangled.`,
          );
        }
        const all = a?.replaceAll === true;
        const next = all ? text.split(find).join(replace) : text.replace(find, replace);
        await writeFile(abs, next, "utf8");
        return { path: p, replaced: all ? text.split(find).length - 1 : 1 };
      },
    },
  ];
}
