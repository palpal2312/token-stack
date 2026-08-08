import type { CliSpec } from "./base";

export const fixture: CliSpec = {
  id: "fixture",
  label: "Test fixture",
  configKey: null,
  resolveBin: () => null,
  protocol: "text",
  capability: {
    nativeActivityTelemetry: true,
    governedExecution: true,
    preExecutionTools: {
      status: "unsupported",
      reason: "The fixture has no paused pre-execution tool-call or tool-result continuation protocol.",
    },
  },
  authKinds: ["none"],
  apiKeyEnv: null,
  isolationEnv: null,
  multiProfile: true,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => [prompt],
  // The fixture speaks a magic plain-text protocol: it prints SESSION:<id>
  // (captured by LineExtractor's text branch) and echoes "resumed:<id>" when
  // this argv shape arrives — so resume plumbing is testable for free.
  resumeArgs: (id, prompt) => ["--resume", id, prompt],
  // `node echo-cli.cjs acp` switches the fixture into a scripted ACP server
  // (initialize/session-new/session-prompt with canned deltas), so the fast
  // lane is testable for free too.
  acpArgv: ["acp"],
  workflow: {
    summary:
      "The QA fixture has no real loop; its fake `mode` knob exists so the delegation tests "
      + "can prove workflow args travel from delegate_task into the child's argv — echo-cli "
      + "prints mode:<value> when --mode arrives.",
    knobs: [
      {
        id: "mode",
        description: "Fake knob for QA: 'fast' or 'slow', delivered as --mode <value>.",
        values: ["fast", "slow"],
        argsFor: (v) => ["--mode", v],
      },
    ],
  },
  notes: "For the QA suite: a Builder with an explicit `bin` (node.exe) and `args` (a script) "
    + "that costs nothing and needs no account. Requires `bin`; there is no default binary.",
};
