import type { CliSpec } from "./base";

export const fixtureClaudeJson: CliSpec = {
  id: "fixture-claude-json",
  label: "Test fixture (claude-stream-json)",
  configKey: null,
  resolveBin: () => null,
  protocol: "claude-stream-json",
  capability: {
    nativeActivityTelemetry: true,
    governedExecution: true,
    preExecutionTools: {
      status: "unsupported",
      reason: "The fixture has no paused pre-execution tool-call or tool-result continuation protocol.",
    },
  },
  authKinds: ["none", "api"],
  apiKeyEnv: null,
  isolationEnv: null,
  multiProfile: true,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => [prompt],
  resumeArgs: (id, prompt) => ["--resume", id, prompt],
  acpArgv: undefined,
  workflow: {
    summary:
      "QA fixture that speaks claude-stream-json protocol (for testing error parsing). "
      + "Requires explicit bin and args pointing at qa/fixtures/*.cjs.",
    knobs: [],
  },
  notes: "For the QA suite: like 'fixture' CLI but speaks claude-stream-json protocol. "
    + "Used by quota-fail-cli.cjs to emit errors in the same protocol as real Claude CLI. "
    + "Requires `bin` (node.exe) and `args` (script path). Governed execution approved.",
};
