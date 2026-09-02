"use client";

/**
 * Module navigation (Phase 19a U1).
 *
 * The desktop shell's left rail is driven entirely by the module registry
 * (`desktop-module-registry.ts`): items render in registry `order`, filtered by
 * host capabilities/permissions, and a same-frame query input filters them by
 * title/route. Navigation order and filtering therefore have ONE source of
 * truth — the registry — not a hardcoded list. Reuses the existing
 * `sidebar-item` / `sidebar-section-label` chrome so the shell reads as NEWS OS.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  BookOpen,
  CalendarClock,
  Columns3,
  LayoutDashboard,
  Repeat,
  Search,
  SlidersHorizontal,
  SquareTerminal,
  Target,
  Waypoints,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import { useIntentPrefetch, useModuleRegistry, useWorkspaceId } from "./desktop-shell";
import { useNavPendingOptional } from "@/context/nav-pending-context";
import { runModuleDataPrefetch } from "@/lib/query/module-prefetch";
import { decideHeavyPreload, loadHeavyChunk } from "@/lib/query/heavy-import-policy";
import type { DesktopModuleDefinition, IconToken } from "./desktop-module-registry";

/** Local web host admits every capability/permission (browser-local adapter). */
const HOST = {
  capabilities: ["terminal", "notifications", "native-dialogs"] as const,
  permissions: ["code-space.run", "approvals.read", "settings.write"] as const,
};

const ICONS: Record<IconToken, LucideIcon> = {
  sen: LayoutDashboard,
  "layout-dashboard": LayoutDashboard,
  "columns-3": Columns3,
  "square-terminal": SquareTerminal,
  brain: Brain,
  "sliders-horizontal": SlidersHorizontal,
  waypoints: Waypoints,
  boxes: Boxes,
  target: Target,
  "book-open": BookOpen,
  "calendar-clock": CalendarClock,
  repeat: Repeat,
};

/** Normalize a title key to text ("nav.kanban" -> "Kanban"). */
export function titleTokenToLabel(titleKey: string): string {
  const raw = titleKey.replace(/^nav\./, "");
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isRouteActive(route: string, activePath: string): boolean {
  if (route === "/sen") return activePath.startsWith("/sen") || activePath.startsWith("/firstmate");
  return activePath === route || (route !== "/" && activePath.startsWith(`${route}/`));
}

export default function ModuleNav() {
  const { modules } = useModuleRegistry();
  const pathname = usePathname();
  const nav = useNavPendingOptional();
  const prefetch = useIntentPrefetch();
  const workspaceId = useWorkspaceId();
  const activePath = nav?.displayPath ?? (pathname ?? "/");
  const [query, setQuery] = useState("");

  // Intent prefetch on hover/focus: this only fires prefetch work — it NEVER
  // begins a nav, so it cannot mark navigation pending. Committed navigation is
  // handled by the shell's commit; same-key in-flight is deduped by the
  // controller.
  const beginPrefetch = useCallback(
    (m: DesktopModuleDefinition) => {
      prefetch.start(m.id, () =>
        Promise.all([
          // (a) module lazy chunk preload
          Promise.resolve(m.load()),
          // (a2) heavy lazy chunk preload for THIS route only — never every module.
          //      The import-policy returns exactly the touched route's heavy chunks.
          ...decideHeavyPreload(m.route).targets.map((c) => loadHeavyChunk(c.specifier)),
          // (b) prefetch data query (no-op for modules without data)
          runModuleDataPrefetch(m.id, { workspaceId, fetch: globalThis.fetch.bind(globalThis) }),
        ]),
      );
    },
    [prefetch, workspaceId],
  );

  const visible = modules.filter((m) => m.requiredCapabilities.every((c) => HOST.capabilities.includes(c)))
    .filter((m) => m.requiredPermissions.every((p) => HOST.permissions.includes(p)));

  const q = query.trim().toLowerCase();
  const filtered = q ? visible.filter((m) => {
    const hay = `${m.titleKey} ${m.route} ${m.id}`.toLowerCase();
    return hay.includes(q);
  }) : visible;

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 h-screen overflow-hidden w-[244px] py-6 border-r border-[var(--line-soft)]"
      style={{ background: "var(--bg-mid)" }}
    >
      <div className="news-brand block mb-5 px-5 shrink-0">
        <div className="news-brand-kicker">Everything · At Once</div>
        <div className="news-brand-title">
          <span className="news-brand-word">NEWS</span>
          <span className="news-brand-mark-aura" aria-hidden="true"><span className="news-brand-mark" /></span>
          <span className="news-brand-os">OS</span>
        </div>
        <div className="news-brand-version" title="NEWS OS version">ver 1.0.0</div>
      </div>

      <div className="px-5 pb-2">
        <label className="relative block">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--cream-dim)" }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter modules"
            aria-label="Filter modules"
            className="w-full h-8 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-deep)] pl-8 pr-2 text-[12px] transition focus:outline-none focus:border-[var(--gold)]"
            style={{ color: "var(--cream)" }}
          />
        </label>
      </div>

      <div className="px-5 pb-1.5">
        <div className="sidebar-section-label">Workspace</div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto sidebar-scroll flex flex-col gap-0.5 px-2 pb-2" aria-label="Modules">
        {filtered.map((m) => {
          const active = isRouteActive(m.route, activePath);
          const Icon = ICONS[m.iconToken] ?? LayoutDashboard;
          return (
            <Link
              key={m.id}
              href={m.route}
              onClick={() => nav?.beginNav(m.route)}
              onMouseEnter={() => beginPrefetch(m)}
              onFocus={() => beginPrefetch(m)}
              aria-current={active ? "page" : undefined}
              className={`sidebar-item nav-enter relative group flex items-center gap-3 py-2.5 px-5 ${active ? "active" : ""}`}
            >
              <span className="nav-icon shrink-0 grid place-items-center w-7 h-7 rounded-md" style={{ color: active ? "var(--gold)" : "var(--cream-dim)" }}>
                <Icon size={17} />
              </span>
              <span>{titleTokenToLabel(m.titleKey)}</span>
              {m.requiredCapabilities.length > 0 && (
                <span className="ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
                  heavy
                </span>
              )}
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-5 py-2 text-[11px]" style={{ color: "var(--cream-dim)" }}>
            No modules match &ldquo;{query}&rdquo;
          </div>
        )}
      </nav>

      <div className="shrink-0 pt-5 mx-5 border-t border-[var(--line-soft)]">
        <div className="sidebar-section-label mb-2">NEWS OS</div>
        <div className="text-[11px] leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          Desktop shell · module registry nav ({filtered.length}/{visible.length})
        </div>
      </div>
    </aside>
  );
}