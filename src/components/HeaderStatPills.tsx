/** Compact status pills for workspace page headers (matches Agent Kanban “Live”). */

export type HeaderStatTone = "neutral" | "ok" | "warn" | "accent";

export type HeaderStat = {
  label: string;
  tone?: HeaderStatTone;
};

const TONE: Record<HeaderStatTone, { border: string; color: string; background: string; dot?: string }> = {
  neutral: {
    border: "var(--line-soft)",
    color: "var(--cream-mute)",
    background: "transparent",
  },
  ok: {
    border: "rgba(90,184,150,.45)",
    color: "#5ab896",
    background: "rgba(90,184,150,.10)",
    dot: "#5ab896",
  },
  warn: {
    border: "rgba(251,191,36,.45)",
    color: "#fbbf24",
    background: "rgba(251,191,36,.10)",
    dot: "#fbbf24",
  },
  accent: {
    border: "rgba(125,211,252,.45)",
    color: "#7dd3fc",
    background: "rgba(125,211,252,.10)",
    dot: "#7dd3fc",
  },
};

export default function HeaderStatPills({
  stats,
  showDot = false,
}: {
  stats: HeaderStat[];
  /** Small status dot like Kanban Live — only for highlighted tones. */
  showDot?: boolean;
}) {
  if (stats.length === 0) return null;
  return (
    <>
      {stats.map((s) => {
        const tone = TONE[s.tone ?? "neutral"];
        return (
          <span
            key={s.label}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: tone.border,
              color: tone.color,
              background: tone.background,
            }}
          >
            {showDot && tone.dot && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
            )}
            {s.label}
          </span>
        );
      })}
    </>
  );
}
