// One-off: register claude-fugu as a Builder from ~/.claude-fugu/settings.json.
const fs = require("fs");
const os = require("os");
const raw = fs.readFileSync(os.homedir() + "/.claude-fugu/settings.json", "utf8").replace(/^﻿/, "");
const s = JSON.parse(raw);
const env = s.env || {};
const body = {
  cli: "claude",
  name: "claude-fugu",
  authKind: "api",
  secrets: { ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN || "" },
  env: {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || "",
    CLAUDE_CONFIG_DIR: os.homedir() + "\\.claude-fugu",
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL || "",
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL || "",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "",
    ANTHROPIC_DEFAULT_FABLE_MODEL: env.ANTHROPIC_DEFAULT_FABLE_MODEL || "",
    CLAUDE_CODE_SUBAGENT_MODEL: env.CLAUDE_CODE_SUBAGENT_MODEL || "",
  },
  notes: "Claude CLI trỏ về Fugu (Sakana API) — mirror của ~/.claude-fugu/settings.json; dùng chung home .claude-fugu để giữ session history.",
};
(async () => {
  const r = await fetch("http://127.0.0.1:3737/api/builders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(r.status, j.builder ? `${j.builder.id} (${j.builder.auth.kind})` : JSON.stringify(j).slice(0, 300));
})();
