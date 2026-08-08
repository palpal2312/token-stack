import type { CliSpec } from "./base";

export const hermes: CliSpec = {
  id: "hermes",
  label: "Hermes",
  configKey: "hermes",
  protocol: "text",
  authKinds: ["oauth", "api", "none"],
  apiKeyEnv: "HERMES_API_KEY",
  isolationEnv: "HERMES_HOME",
  multiProfile: false,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => ["-p", prompt],
  notes: "HERMES_HOME is already the CLI's own contract (see hermesHome() in config.ts), but "
    + "Agent OS reads Hermes state from one shared home, so per-profile homes would split the "
    + "dashboard's view. Left single-profile until that is designed properly.",
};
