import type { CliSpec } from "./base";

export const kimi: CliSpec = {
  id: "kimi",
  label: "Kimi Code",
  configKey: "kimi",
  protocol: "kimi-stream-json",
  capability: {
    nativeActivityTelemetry: true,
    governedExecution: false,
    preExecutionTools: {
      status: "unsupported",
      reason: "Kimi stream-json tool activity is not a proven paused pre-execution call with continuation.",
    },
    unsupportedReason: "Kimi Code has no verified governed descriptor proving both workspace and network boundaries.",
  },
  authKinds: ["oauth", "api"],
  apiKeyEnv: "MOONSHOT_API_KEY",
  isolationEnv: "KIMI_CODE_HOME",
  multiProfile: true,
  versionArgs: ["--version"],
  // Verified on 0.29.2: /usage exists only inside the TUI (Weekly/5h plan
  // quotas); `kimi -p "/usage"` is sent to the model as a prompt instead.
  usageViaTui: true,
  loginArgs: ["login"],
  execArgs: (prompt, o) => {
    const a = ["-p", prompt, "--output-format", "stream-json"];
    if (o?.model) a.push("--model", o.model);
    return a;
  },
  // kimi -S <session_id> -p "<prompt>" — same stream-json, and the meta line
  // confirms the same session id.
  resumeArgs: (id, prompt, o) => {
    const a = ["-S", id, "-p", prompt, "--output-format", "stream-json"];
    if (o?.model) a.push("--model", o.model);
    return a;
  },
  // Verified on 0.29.2 (2026-07-28 spike): `kimi acp` answers initialize,
  // session/new (returns the model list), and session/prompt with token-level
  // agent_message_chunk streaming.
  acpArgv: ["acp"],
  // Verified on 0.29.2: -y/--yolo, --auto, --plan.
  workflow: {
    summary:
      "Kimi Code runs an agentic loop whose permission mode is chosen by a single flag: "
      + "--plan only plans, --auto runs unattended with guardrails, -y/--yolo approves every "
      + "action. These flags are interactive-only: kimi rejects `-p` combined with any of "
      + "them (verified 0.29.2), so print-mode delegation always runs the configured default.",
    knobs: [
      {
        id: "mode",
        description:
          "Permission mode for the loop: 'plan' for a proposal only, 'auto' for unattended with "
          + "guardrails, 'yolo' for approve-everything. Interactive-only — rejected in print mode.",
        values: ["default", "auto", "plan", "yolo"],
        printCompatible: false,
        argsFor: (v) => (v === "default" ? [] : v === "yolo" ? ["-y"] : [`--${v}`]),
      },
    ],
  },
  notes: "KIMI_CODE_HOME verified here 2026-07-27: `kimi doctor` reports config.toml under the "
    + "override dir. KIMI_CONFIG_DIR / KIMI_HOME / KIMI_DIR are ignored. Credentials live in "
    + "<home>/credentials, so a profile dir is a full identity.",
};
