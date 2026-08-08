import type { CliSpec } from "./base";

export const grok: CliSpec = {
  id: "grok",
  label: "Grok Build",
  configKey: "grok",
  protocol: "text",
  authKinds: ["oauth", "api"],
  apiKeyEnv: "XAI_API_KEY",
  isolationEnv: null,
  multiProfile: false,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => ["-p", prompt],
  notes: "Not installed here, so nothing could be verified. Single-profile until someone "
    + "confirms an isolation variable and a print-mode flag on a real install.",
};
