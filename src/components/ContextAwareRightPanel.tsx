"use client";

import { useAukerPanel } from "../context/sen-panel-context";
import DifyWorkflowView from "./DifyWorkflowView";
import KanbanView from "./KanbanView";

// Dynamically render the side panel based on context mode
export function ContextAwareRightPanel() {
  const { mode, data } = useAukerPanel();

  switch (mode) {
    case "dify":
      return (
        <div className="h-full bg-[var(--bg-main)] p-4 overflow-y-auto">
          <DifyWorkflowView />
        </div>
      );
    case "kanban":
      return (
        <div className="h-full bg-[var(--bg-main)] overflow-y-auto">
          {/* Mock KanbanView for now if it requires complex props, or render real one */}
          <KanbanView />
        </div>
      );
    case "memory":
      return (
        <div className="h-full bg-[var(--bg-main)] p-6 overflow-y-auto text-sm text-[var(--fg-dimmer)] flex flex-col items-center justify-center">
          <div className="mono mb-2">Memory Galaxy Vault</div>
          <div>Mode: Memory | {JSON.stringify(data)}</div>
        </div>
      );
    case "mission-control":
      return (
        <div className="h-full bg-[var(--bg-main)] p-6 overflow-y-auto text-sm text-[var(--fg-dimmer)] flex flex-col items-center justify-center">
          <div className="mono mb-2">Sen Mission Control</div>
          <div>Mode: Mission Control</div>
        </div>
      );
    case "code-space":
    case "cli-config":
    default:
      return (
        <div className="h-full p-6 flex flex-col items-center justify-center text-[var(--fg-dimmer)] text-sm">
          <div className="mono mb-2">Panel Content</div>
          <div>Mode: {mode}</div>
        </div>
      );
  }
}
