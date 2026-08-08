"use client";

import { X, AlertTriangle } from "lucide-react";
import HerdrTerminal from "./HerdrTerminal";

interface DebugShellProps {
  open: boolean;
  onClose: () => void;
}

export default function DebugShell({ open, onClose }: DebugShellProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(5,7,12,0.85)" }}>
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border overflow-hidden"
        style={{ borderColor: "var(--line-soft)", background: "var(--bg-deep)" }}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--panel-border)" }}>
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold" style={{ color: "var(--cream)" }}>
              Debug Shell
            </span>
            <span
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border"
              style={{ borderColor: "rgba(251,191,36,.35)", background: "rgba(251,191,36,.10)", color: "#fbbf24" }}
            >
              <AlertTriangle size={11} />
              Not managed by projection
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg border transition hover:bg-white/5"
            style={{ borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}
            title="Close debug shell"
          >
            <X size={14} />
          </button>
        </div>

        {/* Warning banner */}
        <div className="shrink-0 px-4 py-2.5 border-b flex items-start gap-2.5" style={{ borderColor: "var(--panel-border)", background: "rgba(251,191,36,.05)" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
          <div className="text-[11.5px] leading-relaxed" style={{ color: "#fde68a" }}>
            This shell is for manual debugging only. Commands here bypass projection authority and won't be tracked in canonical runtime state.
          </div>
        </div>

        {/* Terminal */}
        <div className="flex-1 min-h-0 p-4">
          <HerdrTerminal fill debugMode />
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t flex justify-end" style={{ borderColor: "var(--panel-border)" }}>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-4 text-[12px] font-medium transition"
            style={{ borderColor: "var(--line-soft)", background: "var(--bg-mid)", color: "var(--cream-mute)" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
