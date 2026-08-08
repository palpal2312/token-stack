import type { CliSpec } from "./base";

export const codex: CliSpec = {
  id: "codex",
  label: "Codex",
  configKey: "codex",
  protocol: "codex-exec-json",
  capability: {
    nativeActivityTelemetry: true,
    governedExecution: true,
    preExecutionTools: {
      status: "unsupported",
      reason: "Codex exec JSON reports command activity, not a proven paused pre-execution call with continuation.",
    },
  },
  authKinds: ["oauth", "api"],
  apiKeyEnv: "OPENAI_API_KEY",
  isolationEnv: "CODEX_HOME",
  multiProfile: true,
  versionArgs: ["--version"],
  // Verified on codex-cli 0.145.0: prints "Logged in using …" and honours
  // CODEX_HOME, so each profile answers for its own account.
  authStatusArgs: ["login", "status"],
  // Verified on 0.145.0 (2026-07-28 spike): initialize → thread/start →
  // turn/start streams item/agentMessage/delta token-level and ends on
  // turn/completed. The bin must be the real vendor codex.exe, not the npm shim.
  acpArgv: ["app-server"],
  laneProtocol: "codex-appserver",
  loginArgs: ["login"],
  execArgs: (prompt, o) => {
    const a = ["exec", "--json"];
    if (o?.model) a.push("--model", o.model);
    // Verified on 0.145.0: -c key=value overrides config.toml for this run.
    if (o?.effort) a.push("-c", `model_reasoning_effort=${o.effort}`);
    a.push(prompt);
    return a;
  },
  // Verified on 0.145.0: `codex exec resume <thread_id> --json "<prompt>"`
  // emits the same JSONL event stream and reuses the thread (thread.started
  // carries the same id). `resume --last` is global-most-recent and would
  // steal an unrelated session — never use it here.
  resumeArgs: (id, prompt, o) => {
    const a = ["exec", "resume", id, "--json"];
    if (o?.model) a.push("--model", o.model);
    if (o?.effort) a.push("-c", `model_reasoning_effort=${o.effort}`);
    a.push(prompt);
    return a;
  },
  // Verified on 0.145.0: -s/--sandbox read-only|workspace-write|danger-full-access.
  workflow: {
    summary:
      "Codex runs `codex exec`: an agentic loop governed by its own sandbox and approval "
      + "policy. The sandbox (-s) caps what the whole loop may touch — read-only, "
      + "workspace-write, or danger-full-access — independent of what the model intends.",
    knobs: [
      {
        id: "sandbox",
        description:
          "Filesystem sandbox for the entire run. 'read-only' is the safe choice; "
          + "'workspace-write' confines writes to the cwd; 'danger-full-access' disables the sandbox.",
        values: ["read-only", "workspace-write", "danger-full-access"],
        argsFor: (v) => ["-s", v],
      },
    ],
  },
  notes: "CODEX_HOME documented (auth.json lives there). Caveat: lib/codexWorkspace.ts reads "
    + "~/.codex directly, so the session-browser tab still shows the default home even when a "
    + "profile repoints CODEX_HOME. On this machine codex resolves only to a .ps1/.cmd shim, "
    + "which Node cannot spawn — a profile needs an absolute .exe in `bin`.",
};
