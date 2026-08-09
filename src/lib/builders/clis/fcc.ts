import type { CliSpec } from "./base";

export const fcc: CliSpec = {
  id: "fcc",
  label: "Free Claude Code",
  configKey: null,
  binOf: "claude",
  // Text, not stream-json: execArgs below asks for `--output-format text`,
  // which is what lib/fcc.ts has always used against the proxy.
  protocol: "text",
  authKinds: ["api", "none"],
  apiKeyEnv: "OPENROUTER_API_KEY",
  isolationEnv: "CLAUDE_CONFIG_DIR",
  multiProfile: true,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => ["-p", "--output-format", "text", prompt],
  notes: "Virtual CLI: not a separate install. It runs the Claude Code binary through "
    + "the local OmniRoute gateway (:20128). Shown as installed only when both Claude "
    + "and OmniRoute are available — Claude alone is not Free Claude Code.",
};
