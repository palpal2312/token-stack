import type { CliSpec } from "./base";

export const openclaw: CliSpec = {
  id: "openclaw",
  label: "OpenClaw",
  configKey: "openclaw",
  protocol: "text",
  authKinds: ["oauth", "api", "none"],
  apiKeyEnv: "OPENCLAW_API_KEY",
  isolationEnv: null,
  multiProfile: false,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => ["-p", prompt],
  notes: "Catalogued so the skins work can bind it. Not installed here.",
};
