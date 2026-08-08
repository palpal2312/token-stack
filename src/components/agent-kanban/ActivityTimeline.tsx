// Event timeline for the card detail drawer. Each event kind gets its own
// icon and each actor a color chip, so a scan of the timeline reads
// stage moves vs runtime changes vs attempt work at a glance.

import {
  Activity,
  ArrowRight,
  Bot,
  Download,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

// The UI-side event shape (looser than the store's canonical KanbanEvent —
// fields may be missing when events arrive over SSE or the canonical
// activity adapter).
export interface KanbanTimelineEvent {
  seq?: number;
  id?: string;
  at?: string;
  type?: string;
  cardId?: string;
  attemptId?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  note?: string;
}

export function formatWhen(value?: string | number): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function eventText(event: KanbanTimelineEvent): string {
  const payload = event.payload ?? {};
  const candidates = [
    event.note,
    payload.note,
    payload.message,
    payload.activity,
    payload.error,
    payload.to ? `Moved to ${String(payload.to)}` : undefined,
  ];
  const detail = candidates.find((value) => typeof value === "string" && value.trim());
  return detail ? String(detail) : String(event.type ?? "Card updated").replaceAll("_", " ");
}

const KIND_ICON: Record<string, typeof Plus> = {
  card_created: Plus,
  card_updated: Pencil,
  card_deleted: Trash2,
  workflow_transition: ArrowRight,
  runtime_changed: Activity,
  attempt_created: Bot,
  attempt_updated: RefreshCw,
  migration_applied: Download,
};

const ACTOR_COLORS: Record<string, string> = {
  user: "#7dd3fc",
  firstmate: "#c084fc",
  owner: "#fbbf24",
  reviewer: "#34d399",
  system: "#94a3b8",
};

export function ActivityTimeline({
  events,
  loading,
  hasMore,
  busy,
  onLoadMore,
}: {
  events: KanbanTimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  busy: string | null;
  onLoadMore: () => void;
}) {
  return (
    <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <History size={13} style={{ color: "#c084fc" }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--cream-mute)]">Event timeline</h3>
      </div>
      {loading ? (
        <p className="inline-flex items-center gap-2 text-[11px] text-[var(--cream-mute)]"><Loader2 size={12} className="animate-spin" /> Loading detail…</p>
      ) : events.length === 0 ? (
        <p className="text-[11px] text-[var(--cream-mute)]">No paged events returned yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event, index) => {
            const Icon = (event.type && KIND_ICON[event.type]) || Activity;
            const actorColor = (event.actor && ACTOR_COLORS[event.actor]) || "#94a3b8";
            return (
              <li key={event.id ?? `${event.seq ?? "event"}-${index}`} className="relative pl-7">
                <span className="absolute left-0 top-0 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[var(--line-soft)] bg-[var(--bg-card)]">
                  <Icon size={10} style={{ color: "#c084fc" }} />
                </span>
                {index < events.length - 1 && <span className="absolute left-[8px] top-5 h-[calc(100%+2px)] w-px bg-[var(--line-soft)]" />}
                <div className="text-[11.5px] text-[var(--cream-soft)]">{eventText(event)}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-[var(--cream-mute)]">
                  <span>{event.type?.replaceAll("_", " ") ?? "event"}</span>
                  {event.actor && (
                    <span
                      className="rounded border px-1 py-px text-[8.5px] font-semibold uppercase tracking-wide"
                      style={{ color: actorColor, borderColor: `${actorColor}55` }}
                    >
                      {event.actor}
                    </span>
                  )}
                  {event.at && <span title={event.at}>{formatWhen(event.at)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {hasMore && (
        <button onClick={onLoadMore} disabled={busy === "events"} className="mt-3 min-h-10 w-full rounded-lg border border-[var(--line-soft)] text-[11px] text-[var(--cream-mute)] disabled:opacity-40">
          {busy === "events" ? "Loading…" : "Load older events"}
        </button>
      )}
    </section>
  );
}
