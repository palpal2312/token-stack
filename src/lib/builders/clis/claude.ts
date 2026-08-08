import type { CliSpec } from "./base";

export const claude: CliSpec = {
  id: "claude",
  label: "Claude Code",
  configKey: "claude",
  protocol: "claude-stream-json",
  capability: {
    nativeActivityTelemetry: true,
    governedExecution: false,
    preExecutionTools: {
      status: "unsupported",
      reason: "Claude stream-json tool activity is not a proven paused pre-execution call with continuation.",
    },
    unsupportedReason: "Claude Code has no verified governed descriptor proving both workspace and network boundaries.",
  },
  authKinds: ["oauth", "api"],
  apiKeyEnv: "ANTHROPIC_API_KEY",
  isolationEnv: "CLAUDE_CONFIG_DIR",
  multiProfile: true,
  versionArgs: ["--version"],
  // Verified on 2.1.195: prints JSON {"loggedIn": bool, ...} and honours
  // CLAUDE_CONFIG_DIR, so each profile answers for its own account.
  authStatusArgs: ["auth", "status"],
  loginArgs: ["/login"],
  execArgs: (prompt, o) => {
    const a = ["-p"];
    if (o?.model) a.push("--model", o.model);
    // Verified on 2.1.195: --effort <level> exists.
    if (o?.effort) a.push("--effort", o.effort);
    a.push("--output-format", "stream-json", "--include-partial-messages", "--verbose", prompt);
    return a;
  },
  // claude -p --resume <sessionId> "<prompt>" — same stream, prior context kept.
  resumeArgs: (id, prompt, o) => {
    const a = ["-p"];
    if (o?.model) a.push("--model", o.model);
    if (o?.effort) a.push("--effort", o.effort);
    a.push("--output-format", "stream-json", "--include-partial-messages", "--verbose", "--resume", id, prompt);
    return a;
  },
  // Verified on 2.1.195 (2026-07-28 spike): one persistent process serves many
  // turns — write {"type":"user","message":...} lines to stdin, read
  // stream_event deltas + a per-turn "result" back. ~3s warm turns.
  acpArgv: ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"],
  laneProtocol: "claude-duplex",
  // Verified on 2.1.195: --permission-mode, --allowedTools, --disallowedTools.
  // The tool lists are free-form (not enumerable), so only the mode is a knob.
  workflow: {
    summary:
      "Claude Code runs an agentic loop (read, edit, run, repeat) under a permission mode that "
      + "decides how much it may do without asking: plan only proposes, acceptEdits applies file "
      + "edits on its own, bypassPermissions runs everything unattended. Tool allow/deny lists "
      + "exist but take free-form values, so they are not exposed as a knob.",
    knobs: [
      {
        id: "permission",
        description:
          "How much the loop may do without asking. 'plan' is the safe choice (proposal only); "
          + "'acceptEdits' lets it edit files; 'bypassPermissions' is full yolo.",
        values: ["default", "plan", "acceptEdits", "bypassPermissions"],
        argsFor: (v) => (v === "default" ? [] : ["--permission-mode", v]),
      },
    ],
  },
  notes: "CLAUDE_CONFIG_DIR documented; each profile dir holds its own OAuth session. "
    + "API-key profiles set ANTHROPIC_API_KEY in the child env only — never globally, "
    + "because an empty/foreign key breaks the CLI's own login session.",
};
