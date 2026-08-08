import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import type { CliSpec } from "./base";

// Verified on this machine 2026-07-28, agy.exe 1.1.8 (the real Antigravity CLI):
// `%LOCALAPPDATA%\agy\bin\agy.exe`. `-p/--print` runs one non-interactive turn,
// `--output-format text|json|stream-json`; `agy models` lists the models the
// signed-in account can run — it answers only when the OAuth session is alive,
// which makes it the auth-status check. Its own loop has plan/accept-edits
// modes, effort levels, and a skip-permissions flag (see workflow contract).
//
// Two spawn quirks, both verified against this binary the hard way:
//  - agy REFUSES to run without a console: on a plain pipe it exits instantly
//    with no stdout, no stderr and a null exit code. Hence requiresPty — every
//    real turn goes through node-pty (lib/builders/ptySpawn.ts).
//  - Flags are only parsed AFTER the positional prompt. `agy --print --model X
//    "..."` silently swallows --model into the prompt text (the model answers
//    about the flag instead of running it); `agy --print "..." --model X` is
//    honoured. execArgs therefore puts the prompt first.
const defaultBin = path.join(os.homedir(), "AppData", "Local", "agy", "bin", "agy.exe");

export const antigravity: CliSpec = {
  id: "antigravity",
  label: "Antigravity",
  configKey: "antigravity",
  resolveBin: () => (process.env.AGY_BIN && existsSync(process.env.AGY_BIN))
    ? process.env.AGY_BIN
    : (existsSync(defaultBin) ? defaultBin : null),
  protocol: "agy-stream-json",
  // agy.exe exits silently on a plain pipe — see the header comment. The chat
  // lane (runBuilderChat) routes through node-pty because of this flag.
  requiresPty: true,
  // Login lives in agy's own account store; there is no proven isolation
  // variable, so profiles share the existing login ("none") — a second
  // account cannot be kept separate yet, same honesty rule as the others.
  authKinds: ["none"],
  apiKeyEnv: null,
  isolationEnv: null,
  multiProfile: false,
  versionArgs: ["--version"],
  // `agy models` exits 0 with a model list only when the OAuth session works.
  authStatusArgs: ["models"],
  loginArgs: null,
  execArgs: (prompt, o) => {
    // Prompt FIRST: agy parses flags only when they follow the positional
    // prompt — `agy --print --model X "..."` leaks --model into the prompt
    // text, while `agy --print "..." --model X` is honoured (verified 1.1.8
    // on this machine, including --output-format text and a bogus --model
    // producing a proper "invalid model selection" error only in this order).
    // stream-json verified 2026-07-29: the equals form after the prompt emits
    // init / step_update(text_delta) / result — token streaming, the live
    // model name, and the conversation id for resume.
    const a = ["--print", prompt, "--output-format=stream-json"];
    if (o?.model) a.push("--model", o.model);
    if (o?.effort) a.push("--effort", o.effort);
    return a;
  },
  // Verified on 1.1.8 (2026-07-29): `--conversation <id>` continues the stored
  // conversation — a follow-up turn remembered a fact from the first without
  // any history being re-sent. Same flag order rules as execArgs.
  resumeArgs: (id, prompt, o) => {
    const a = ["--print", prompt, "--output-format=stream-json", "--conversation", id];
    if (o?.model) a.push("--model", o.model);
    if (o?.effort) a.push("--effort", o.effort);
    return a;
  },
  workflow: {
    summary:
      "Agy runs its own agent loop with an execution mode (plan | accept-edits), " +
      "a reasoning effort (low|medium|high), a sandbox flag for terminal restrictions, " +
      "and --dangerously-skip-permissions for unattended runs. Approvals are its own.",
    knobs: [
      {
        id: "mode",
        description: "Execution mode: plan (review first) or accept-edits (apply edits directly). Default = agy's own.",
        values: ["default", "plan", "accept-edits"],
        argsFor: (v) => (v === "default" ? [] : ["--mode", v]),
      },
      {
        id: "effort",
        description: "Reasoning effort for the session.",
        values: ["default", "low", "medium", "high"],
        argsFor: (v) => (v === "default" ? [] : ["--effort", v]),
      },
      {
        id: "permissions",
        description: "'skip' auto-approves every tool permission (unattended runs); 'default' keeps agy's prompts.",
        values: ["default", "skip"],
        argsFor: (v) => (v === "skip" ? ["--dangerously-skip-permissions"] : []),
      },
    ],
  },
  notes:
    "Verified 1.1.8 at %LOCALAPPDATA%\\agy\\bin\\agy.exe. Shared login only — " +
    "no isolation variable has been proven, so it stays one account. " +
    "`agy models` doubles as the auth check and the model list.",
};
