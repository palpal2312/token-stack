import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";

interface Worker {
  worker_id: string;
  profile?: { provider_id?: string; tier?: string; is_sandbox?: boolean; status?: string; reason?: string };
  health: string;
  effective_health: string;
  active_sandboxes: number;
  last_seen_at: string;
}

function tone(worker: Worker): { color: string; Icon: typeof Circle } {
  if (worker.effective_health === "healthy") return { color: "#86efac", Icon: CheckCircle2 };
  if (worker.effective_health === "degraded") return { color: "#fbbf24", Icon: AlertTriangle };
  return { color: "#fda4af", Icon: Circle };
}

export default function WorkerHealth({ workers, error, compact = false }: { workers: Worker[]; error: string | null; compact?: boolean }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
        Sandbox provider health
      </h2>
      {error ? (
        <div className="rounded-lg border p-2.5 text-[11px]" style={{ borderColor: "rgba(251,191,36,.35)", color: "#fde68a" }}>
          Provider health unavailable: {error}
        </div>
      ) : (
        <div className="space-y-1.5">
          {workers.map((worker) => {
            const { color, Icon } = tone(worker);
            return (
              <div key={worker.worker_id} className={`rounded-lg border ${compact ? "p-2.5" : "p-3"}`} style={{ borderColor: "var(--line-soft)" }}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ color: "var(--cream)" }}>
                    <Icon size={13} style={{ color }} />
                    <span className="truncate">{worker.worker_id}</span>
                  </span>
                  <span className="shrink-0 uppercase tracking-wide" style={{ color }}>{worker.effective_health}</span>
                </div>
                <div className="mt-1 text-[10px]" style={{ color: "var(--fg-dim)" }}>
                  {worker.profile?.is_sandbox ? "AgentENV sandbox" : "Direct / No Sandbox"}
                  {worker.profile?.tier ? ` · ${worker.profile.tier}` : ""}
                  {` · ${worker.active_sandboxes} active`}
                </div>
                {worker.profile?.reason && <div className="mt-1 text-[10px]" style={{ color: "var(--fg-dimmer)" }}>{worker.profile.reason}</div>}
              </div>
            );
          })}
          {workers.length === 0 && <div className="text-[12px] text-[var(--fg-dimmer)] px-1 py-2">No registered provider workers.</div>}
        </div>
      )}
    </section>
  );
}
