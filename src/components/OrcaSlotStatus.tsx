// Read-only Orca slot status shell (PD lane, SO0F). Pure render of the
// fixture-developed SlotView model: no controls, no polling, no mutation —
// J1 wires data in through the existing Code Space query round-trip.
// Sprint 04: surfaces typed reconnect/reattach, cursor, capability errors,
// and observe-only diagnostics.

import { AlertTriangle, Circle, CircleOff, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { SlotView } from "@/lib/agentRuntime/orca-slot-client";

function tone(status: SlotView["status"]): { color: string; Icon: typeof Circle } {
  switch (status) {
    case "available": return { color: "#86efac", Icon: Circle };
    case "drifted": return { color: "#fbbf24", Icon: AlertTriangle };
    case "disabled": return { color: "var(--fg-dimmer)", Icon: CircleOff };
    case "loading": return { color: "var(--cream-mute)", Icon: Loader2 };
    default: return { color: "#fda4af", Icon: XCircle };
  }
}

export default function OrcaSlotStatus({ view }: { view: SlotView }) {
  const { color, Icon } = tone(view.status);
  const reconcile = view.reconcile;
  const showReconnect = Boolean(view.reconnectHint) || view.status === "drifted";
  const observeOnly = reconcile?.observe_only === true
    || reconcile?.phase === "observe_only"
    || view.capabilityError?.code === "capability_revoked";
  const cap = view.capabilityError;
  const cursor = view.cursor;

  return (
    <section className="space-y-1.5" aria-label="Orca slot status">
      <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
        Orca Lab slot
      </h2>
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ color: "var(--cream)" }}>
            <Icon size={13} style={{ color }} />
            <span className="truncate">{view.builderLabel ?? "No Builder bound"}</span>
          </span>
          <span className="shrink-0 uppercase tracking-wide" style={{ color }}>{view.statusText}</span>
        </div>
        <div className="mt-1 text-[10px]" style={{ color: "var(--fg-dim)" }}>
          {view.capacity !== null && view.inFlight !== null
            ? `WIP ${view.inFlight}/${view.capacity}`
            : "WIP —"}
          {view.attemptRef ? ` · Attempt ${view.attemptRef}` : ""}
          {view.lastObservedAt ? ` · observed ${view.lastObservedAt}` : ""}
          {cursor ? ` · cursor ${cursor.output_cursor}` : ""}
        </div>
        {view.reason && (
          <div className="mt-1 text-[10px]" style={{ color: "var(--fg-dimmer)" }}>{view.reason}</div>
        )}
        {cap && (
          <div
            className="mt-2 rounded-md border px-2 py-1.5 text-[10px]"
            style={{ borderColor: "rgba(251,113,133,.4)", color: "#fecdd3" }}
            aria-label="Capability error"
          >
            <span className="uppercase tracking-wide">{cap.code.replace(/_/g, " ")}</span>
            <span> — {cap.message}</span>
            {cap.active_dispatch_id ? ` · active ${cap.active_dispatch_id}` : ""}
            {cap.attempt_dispatch_id ? ` · attempt ${cap.attempt_dispatch_id}` : ""}
          </div>
        )}
        {showReconnect && (
          <div
            className="mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px]"
            style={{ borderColor: "rgba(251,191,36,.35)", color: "#fde68a" }}
            aria-label="Reconnect status"
          >
            <RefreshCw size={11} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {view.reconnectHint ?? "Reconciling — awaiting canonical replace."}
              {reconcile?.reattach_count != null && reconcile.reattach_count > 0
                ? ` · reattach ×${reconcile.reattach_count}`
                : ""}
              {reconcile?.last_seq != null ? ` · seq ${reconcile.last_seq}` : ""}
              {cursor ? ` · ${cursor.dispatch_id}@${cursor.output_cursor}` : ""}
            </span>
          </div>
        )}
        {observeOnly && (
          <div
            className="mt-1.5 text-[9px] uppercase tracking-wide"
            style={{ color: "var(--fg-dimmer)" }}
            aria-label="Observe only"
          >
            Observe-only diagnostics · no slot mutation
          </div>
        )}
      </div>
    </section>
  );
}
