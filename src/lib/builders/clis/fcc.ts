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
  notes: "Virtual CLI: the claude binary pointed at a local proxy via env (see lib/fcc.ts). "
    + "The precedent this whole Builder system generalizes.",
};
