import path from "node:path";
import os from "node:os";
import type { CliSpec } from "./base";

export const opencode: CliSpec = {
  id: "opencode",
  label: "opencode",
  configKey: null,
  resolveBin: () => process.env.OPENCODE_BIN || path.join(os.homedir(), ".opencode", "bin", "opencode"),
  protocol: "text",
  authKinds: ["oauth", "api", "none"],
  apiKeyEnv: "OPENCODE_API_KEY",
  isolationEnv: null,
  multiProfile: false,
  versionArgs: ["--version"],
  loginArgs: null,
  execArgs: (prompt) => ["run", prompt],
  notes: "Resolves through lib/opencode.ts (OPENCODE_BIN ?? ~/.opencode/bin/opencode), not the "
    + "shared config — the resolver here mirrors that, and a Builder can always override `bin`.",
};
