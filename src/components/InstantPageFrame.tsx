"use client";

import type { ReactNode } from "react";
import {
  Brain,
  Boxes,
  CalendarClock,
  LayoutDashboard,
  Repeat,
  SlidersHorizontal,
  SquareTerminal,
  Target,
  Waypoints,
} from "lucide-react";
import PageHeaderIcon from "./PageHeaderIcon";
import { ClientCacheKeys, peekCache } from "@/lib/client-data-cache";

type FrameMeta = {
  title: string;
  sub: string;
  gradient: string;
  icon: ReactNode;
};

const FRAMES: Record<string, FrameMeta> = {
  "/sen": {
    title: "Sen",
    sub: "Central orchestrator — mother agent and CLI workers.",
    gradient: "linear-gradient(135deg,#7dd3fc,#38bdf8)",
    icon: <span className="sen-nav-icon" aria-hidden="true" />,
  },
  "/agent-kanban": {
    title: "Agent Kanban",
    sub: "Planner, builder, and reviewer cards on a live board.",
    gradient: "linear-gradient(135deg,#7dd3fc,#38bdf8)",
    icon: <LayoutDashboard size={18} />,
  },
  "/code-space": {
    title: "Code Space",
    sub: "Running job status and Herdr panes — terminal via Debug Shell.",
    gradient: "linear-gradient(135deg,#818cf8,#6366f1)",
    icon: <SquareTerminal size={18} />,
  },
  "/memory": {
    title: "Memory",
    sub: "Notes, chat logs, and remembered workspace context.",
    gradient: "linear-gradient(135deg,#22d3ee,#06b6d4)",
    icon: <Brain size={18} />,
  },
  "/builders": {
    title: "CLI Config",
    sub: "Builder profiles — accounts, models, effort, quota, health.",
    gradient: "linear-gradient(135deg,#22d3ee,#06b6d4)",
    icon: <SlidersHorizontal size={18} />,
  },
  "/routers": {
    title: "Router Config",
    sub: "API routing endpoints for CLI profiles.",
    gradient: "linear-gradient(135deg,#2dd4bf,#14b8a6)",
    icon: <Waypoints size={18} />,
  },
  "/integrations": {
    title: "Integrations",
    sub: "Open-source tools Agent OS builds on.",
    gradient: "linear-gradient(135deg,#94a3b8,#64748b)",
    icon: <Boxes size={18} />,
  },
  "/goals": {
    title: "Goals & Workflows",
    sub: "Targets, progress, and workflows saved locally.",
    gradient: "linear-gradient(135deg,#fbbf24,#f59e0b)",
    icon: <Target size={18} />,
  },
  "/automations": {
    title: "Automations",
    sub: "Scheduled runs, wake-ups, and the approval inbox.",
    gradient: "linear-gradient(135deg,#fbbf24,#f59e0b)",
    icon: <CalendarClock size={18} />,
  },
  "/loop": {
    title: "Loop",
    sub: "Define done, build, verify, repeat until the gate passes.",
    gradient: "linear-gradient(135deg,#2dd4bf,#14b8a6)",
    icon: <Repeat size={18} />,
  },
};

function metaFor(path: string): FrameMeta {
  if (path.startsWith("/sen") || path.startsWith("/firstmate")) return FRAMES["/sen"];
  return FRAMES[path] ?? {
    title: path === "/" ? "Mission Control" : path.replace(/^\//, ""),
    sub: "Loading this section…",
    gradient: "linear-gradient(135deg,#d4a574,#b8956a)",
    icon: <LayoutDashboard size={18} />,
  };
}

function cachedHint(path: string): string | null {
  if (path === "/builders") {
    const j = peekCache<Record<string, unknown>>(ClientCacheKeys.builders);
    const builders = (j?.builders as unknown[]) ?? [];
    const clis = (j?.clis as unknown[]) ?? [];
    if (builders.length || clis.length) {
      return `${builders.length} profiles · ${clis.length} CLIs (cached)`;
    }
  } else if (path === "/routers") {
    const j = peekCache<Record<string, unknown>>(ClientCacheKeys.routers);
    const routers = (j?.routers as unknown[]) ?? [];
    if (routers.length) return `${routers.length} routers (cached)`;
  } else if (path === "/integrations") {
    const j = peekCache<Record<string, unknown>>(ClientCacheKeys.integrations);
    const items = (j?.integrations as unknown[]) ?? (j?.items as unknown[]) ?? [];
    if (items.length) return `${items.length} integrations (cached)`;
  } else if (path === "/code-space") {
    const j = peekCache<Record<string, unknown>>(ClientCacheKeys.herdrSnapshot);
    const snap = j?.snapshot as { panes?: unknown[] } | null;
    const attempts = (j?.runtimeAttempts as unknown[]) ?? [];
    if (snap || attempts.length) {
      return `${attempts.length} jobs · ${(snap?.panes ?? []).length} panes (cached)`;
    }
  }
  return null;
}

/**
 * Static chrome shown the instant a sidebar click starts navigating —
 * title + frame before the real page segment finishes mounting.
 * Warm client cache (if any) paints a one-line hint immediately.
 */
export default function InstantPageFrame({ path }: { path: string }) {
  const meta = metaFor(path);
  const hint = cachedHint(path);

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
        <PageHeaderIcon gradient={meta.gradient}>
          {meta.icon}
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cream)]">
            {meta.title}
          </div>
          <div className="text-[12px] text-[var(--cream-mute)] mt-0.5 line-clamp-2">
            {meta.sub}
          </div>
        </div>
        <div
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] animate-pulse" />
          Loading
        </div>
      </header>

      <div
        className="flex-1 min-h-0 rounded-xl border overflow-hidden p-4 space-y-3"
        style={{ borderColor: "var(--line-soft)", background: "var(--bg-deep)" }}
      >
        {hint ? (
          <div className="text-[12px] text-[var(--cream-mute)]">{hint}</div>
        ) : (
          <div className="h-3 w-40 rounded bg-white/5 animate-pulse" />
        )}
        <div className="h-24 rounded-lg border border-[var(--line-soft)] bg-white/[0.03] animate-pulse" />
        <div className="h-24 rounded-lg border border-[var(--line-soft)] bg-white/[0.03] animate-pulse" />
        <div className="h-16 rounded-lg border border-[var(--line-soft)] bg-white/[0.03] animate-pulse" />
      </div>
    </div>
  );
}
