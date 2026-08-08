// Client-safe Sen labels — no Node/MCP imports. UI surfaces import from
// here; the full preset builder stays in sen.ts for the agent runtime.

export const AUKER_NAME = "Sen";

/** User-facing capability groups for the Sen Agent panel. */
export const AUKER_CAPABILITIES = [
  { id: "deliverables", label: "Deliverables", detail: "Document, spreadsheet, web page → artifacts folder" },
  { id: "files", label: "Files", detail: "Read, write, edit, list in the run workspace" },
  { id: "git", label: "Git", detail: "Status, diff, commit inside the jail" },
  { id: "shell", label: "Shell", detail: "Allowlisted commands — parks for approval" },
  { id: "workers", label: "Workers", detail: "List Builder profiles and delegate subtasks" },
  { id: "mcp", label: "MCP", detail: "Tools from connectors you configure below" },
  { id: "panes", label: "Pane workers", detail: "Long-running Herdr panes when Herdr is up" },
] as const;
