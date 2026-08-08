import type { CliSpec } from "./base";

export const cursor: CliSpec = {
  id: "cursor",
  label: "Cursor CLI",
  configKey: "cursor",
  protocol: "text",
  authKinds: ["oauth", "api"],
  apiKeyEnv: "CURSOR_API_KEY",
  isolationEnv: null,
  multiProfile: false,
  versionArgs: ["--version"],
  loginArgs: ["login"],
  execArgs: (prompt) => ["-p", prompt],
  notes: "New to Agent OS and not installed here. Binary is usually `cursor-agent`.",
};
