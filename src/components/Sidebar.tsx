"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Brain, BookOpen, TrendingUp, Columns3, NotebookText, Film, Building2, Workflow, MessagesSquare, Image as ImageIcon, Gamepad2, Music2, Network, Clapperboard, Repeat, Cpu, LayoutDashboard, Palette, GripVertical, Eye, EyeOff, SlidersHorizontal, Check, SquareTerminal, Route, Scissors, FlaskConical, Swords, Bot, Plus, Boxes, Waypoints, CalendarClock, ChevronDown, Target } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import AgentAvatar from "./AgentAvatar";
import {
  CachePresets,
  ClientCacheKeys,
  cachedFetchJson,
  invalidateCache,
  readCache,
  setCache,
} from "@/lib/client-data-cache";
import { useNavPendingOptional } from "@/context/nav-pending-context";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  accent: string;
  dim: string;
}

const NAV: NavItem[] = [
  { href: "/paperclip", label: "Paperclip", icon: <Building2 size={16} />, accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/room",     label: "AI Agent Mastermind", icon: <MessagesSquare size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/pipeline", label: "Pipeline", icon: <Workflow size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  // Agents — use real avatar logos
  { href: "/claude",   label: "Claude",   icon: <AgentAvatar agent="claude" size={22} />,   accent: "#d97757", dim: "rgba(217,119,87,0.16)" },
  { href: "/openclaw", label: "OpenClaw", icon: <AgentAvatar agent="openclaw" size={22} />, accent: "#f472b6", dim: "rgba(244,114,182,0.16)" },
  { href: "/hermes",   label: "Hermes",   icon: <AgentAvatar agent="hermes" size={22} />,   accent: "#60a5fa", dim: "rgba(96,165,250,0.16)" },
  // Gemini CLI removed 2026-06-23 — Google retired it (18 Jun 2026); Antigravity CLI (below) is its successor.
  { href: "/antigravity", label: "Antigravity", icon: <AgentAvatar agent="antigravity" size={22} />, accent: "#7c3aed", dim: "rgba(124,58,237,0.16)" },
  { href: "/codex",       label: "Codex",       icon: <AgentAvatar agent="codex" size={22} />,       accent: "#22c55e", dim: "rgba(34,197,94,0.16)" },
  { href: "/kimi",        label: "Kimi Code",   icon: <AgentAvatar agent="kimi" size={22} />,        accent: "#00CCFF", dim: "rgba(0,204,255,0.16)" },
  { href: "/glm",         label: "GLM 5.2",     icon: <AgentAvatar agent="glm" size={22} />,         accent: "#34E5B0", dim: "rgba(52,229,176,0.16)" },
  { href: "/glm-code",    label: "GPT 5.6 Code", icon: <SquareTerminal size={18} />,                 accent: "#10b981", dim: "rgba(16,185,129,0.16)" },
  { href: "/grok",        label: "Grok Build",  icon: <AgentAvatar agent="grok" size={22} />,        accent: "#cdd3f7", dim: "rgba(205,211,247,0.16)" },
  { href: "/freeclaude",  label: "Free Claude Code", icon: <AgentAvatar agent="fcc" size={22} />,    accent: "#10b981", dim: "rgba(16,185,129,0.16)" },
  { href: "/omniroute",   label: "OmniRoute",   icon: <Route size={18} />,                            accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  { href: "/hy3-coder",   label: "Hy3 Coder",   icon: <Cpu size={18} />,                              accent: "#3b82f6", dim: "rgba(59,130,246,0.16)" },
  { href: "/opencode",    label: "opencode",    icon: <SquareTerminal size={18} />,                   accent: "#38bdf8", dim: "rgba(56,189,248,0.16)" },
  { href: "/fusion",      label: "Fusion",      icon: <Network size={18} />,                         accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/sakana",      label: "Sakana Fugu", icon: <Network size={18} />,                         accent: "#ff5f9e", dim: "rgba(255,95,158,0.16)" },
  { href: "/local",       label: "Local",       icon: <Cpu size={18} />,                             accent: "#5eead4", dim: "rgba(94,234,212,0.16)" },
  { href: "/sen",       label: "Sen",        icon: <span className="sen-nav-icon" aria-hidden="true" />, accent: "#7dd3fc", dim: "rgba(125,211,252,0.16)" },
  { href: "/agent-kanban", label: "Agent Kanban", icon: <LayoutDashboard size={18} />,                accent: "#7dd3fc", dim: "rgba(125,211,252,0.16)" },
  { href: "/code-space",  label: "Code Space",  icon: <SquareTerminal size={17} />,                  accent: "#818cf8", dim: "rgba(129,140,248,0.16)" },
  { href: "/memory",      label: "Memory",      icon: <Brain size={16} />,                           accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  { href: "/builders",    label: "CLI Config",  icon: <SlidersHorizontal size={17} />,               accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  { href: "/routers",     label: "Router Config", icon: <Waypoints size={17} />,                     accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  { href: "/integrations", label: "Integrations", icon: <Boxes size={16} />,                        accent: "#94a3b8", dim: "rgba(148,163,184,0.16)" },
  { href: "/goals",       label: "Goals & Workflows", icon: <Target size={16} />,                   accent: "#fbbf24", dim: "rgba(251,191,36,0.16)" },
  { href: "/journal",     label: "Journal",     icon: <BookOpen size={16} />,                        accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  { href: "/automations", label: "Automations", icon: <CalendarClock size={17} />,                   accent: "#fbbf24", dim: "rgba(251,191,36,0.16)" },
  { href: "/arena",       label: "Arena",       icon: <Swords size={17} />,                          accent: "#fb923c", dim: "rgba(251,146,60,0.16)" },
  // Personal
  { href: "/loop",     label: "Loop",     icon: <Repeat size={16} />,   accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  { href: "/seo",      label: "SEO",      icon: <TrendingUp size={16} />, accent: "#a3e635", dim: "rgba(163,230,53,0.16)" },
  { href: "/opendesign", label: "Open Design", icon: <Palette size={16} />, accent: "#e879f9", dim: "rgba(232,121,249,0.16)" },
  { href: "/video",    label: "Video",    icon: <Film size={16} />,      accent: "#ef4444", dim: "rgba(239,68,68,0.16)" },
  { href: "/openmontage", label: "OpenMontage", icon: <Clapperboard size={16} />, accent: "#f0a868", dim: "rgba(240,168,104,0.16)" },
  { href: "/video-use", label: "Video Editor", icon: <Scissors size={16} />, accent: "#f59e0b", dim: "rgba(245,158,11,0.16)" },
  { href: "/music",    label: "Music",    icon: <Music2 size={16} />,    accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  { href: "/games",    label: "Game Studio", icon: <Gamepad2 size={16} />, accent: "#39ff8e", dim: "rgba(57,255,142,0.16)" },
  { href: "/apps",     label: "App Lab",  icon: <FlaskConical size={16} />, accent: "#a3e635", dim: "rgba(163,230,53,0.16)" },
  { href: "/thumbnails", label: "Thumbnails", icon: <ImageIcon size={16} />, accent: "#fb7185", dim: "rgba(251,113,133,0.16)" },
  { href: "/notebook", label: "Notebook", icon: <NotebookText size={16} />, accent: "#fde047", dim: "rgba(253,224,71,0.16)" },
  { href: "/kanban",   label: "Kanban",   icon: <Columns3 size={16} />,  accent: "#14b8a6", dim: "rgba(20,184,166,0.16)" },
  { href: "/dify",     label: "Dify",     icon: <Workflow size={16} />,  accent: "#0ea5e9", dim: "rgba(14,165,233,0.16)" },
];

const DEFAULT_ORDER = NAV.map((n) => n.href);
const BY_HREF: Record<string, NavItem> = Object.fromEntries(NAV.map((n) => [n.href, n]));
// These tabs are now Agent Skins: the reusable interface half of an agent. They
// keep their own pages — every one of them is a full console, and a skin is only
// the chat part — but "Agents" below lists the agents you actually created.
const SKIN_ROUTES = new Set(["/claude", "/openclaw", "/hermes", "/antigravity", "/codex", "/kimi", "/glm", "/glm-code", "/grok", "/freeclaude", "/omniroute", "/hy3-coder", "/fusion", "/sakana", "/local", "/opencode"]);
const LS_ORDER = "agentos.sidebar.order";
const LS_HIDDEN = "agentos.sidebar.hidden";
const LS_COLLAPSED = "agentos.sidebar.collapsed";

// Sidebar grouping. Dashboard (ex–Mission Control) lives as a tab inside Sen.
// Paperclip + AI Agent Mastermind + Pipeline + Arena get their own "Agent Orchestration" group;
// created agents + nested Agent Skins under "Agents"; everything else under "Apps".
const WORKSPACE_ORDER = [
  "/sen", "/agent-kanban", "/code-space", "/memory", "/builders", "/routers",
  "/integrations", "/goals", "/journal", "/automations", "/loop",
];
const WORKSPACE_ROUTES = new Set([...WORKSPACE_ORDER, "/firstmate"]);
const ORCHESTRATION_ROUTES = new Set(["/paperclip", "/room", "/pipeline", "/arena", "/dify"]);

type SectionName = "Workspace" | "Agent Orchestration" | "Agents" | "Apps";
const SECTION_ORDER: SectionName[] = ["Workspace", "Agent Orchestration", "Agents", "Apps"];

function sectionOf(href: string): SectionName {
  if (WORKSPACE_ROUTES.has(href)) return "Workspace";
  if (href.startsWith("/agents")) return "Agents";
  if (ORCHESTRATION_ROUTES.has(href)) return "Agent Orchestration";
  if (SKIN_ROUTES.has(href)) return "Agents"; // nested under Agents
  return "Apps";
}

function sectionForPath(pathname: string): SectionName {
  if (pathname.startsWith("/sen") || pathname.startsWith("/firstmate")) return "Workspace";
  if (pathname.startsWith("/agents") || SKIN_ROUTES.has(pathname)) return "Agents";
  // Longest nav href match so /video-use wins over /video.
  let best: { href: string; sec: SectionName } | null = null;
  for (const href of Object.keys(BY_HREF)) {
    if (pathname === href || pathname.startsWith(href + "/") || (href !== "/" && pathname.startsWith(href))) {
      if (!best || href.length > best.href.length) best = { href, sec: sectionOf(href) };
    }
  }
  return best?.sec ?? "Workspace";
}

const NEW_AGENT_HREF = "/agents/new";
interface AgentRow { id: string; name: string; skinId: string; ready: boolean }

export default function Sidebar() {
  const pathname = usePathname();
  const nav = useNavPendingOptional();
  // Prefer pending target so the active item + section flip on click, before
  // Next finishes mounting the destination page.
  const activePath = nav?.displayPath ?? pathname;
  const beginNav = nav?.beginNav;
  const [mounted, setMounted] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<string[]>([]);
  const [customize, setCustomize] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseReady, setCollapseReady] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overHref, setOverHref] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  // Only one section open at a time; Workspace is the default.
  const [expandedSection, setExpandedSection] = useState<SectionName>("Workspace");
  // Agent Skins nests under Agents — collapsed until opened or a skin route is active.
  const [skinsOpen, setSkinsOpen] = useState(false);
  const onSkinRoute = SKIN_ROUTES.has(activePath);

  // Follow the active (or pending) route into its section (exclusive accordion).
  useEffect(() => {
    setExpandedSection(sectionForPath(activePath));
    setSkinsOpen(onSkinRoute);
  }, [activePath, onSkinRoute]);

  // Pending approvals deserve to be seen from anywhere, not only when the
  // Automations page is open — a parked Sen run is a queue, and queues
  // die quietly. Light poll, GET only; the token is injected by the layout.
  useEffect(() => {
    const load = () => {
      fetch("/api/approvals", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setPendingApprovals(Number(j.pending) || 0))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // The Agents section is whatever the user has created — empty until they do.
  // Creating or deleting one fires this event so the list updates without a
  // reload, which matters because the create flow navigates straight to it.
  useEffect(() => {
    const load = () => {
      fetch("/api/agents", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setAgents(Array.isArray(j.agents) ? j.agents : []))
        .catch(() => { /* the section just stays empty */ });
    };
    load();
    window.addEventListener("agentos:agents-changed", load);
    return () => window.removeEventListener("agentos:agents-changed", load);
  }, []);

  // load saved prefs (client only)
  useEffect(() => {
    setMounted(true);
    try {
      const o = JSON.parse(localStorage.getItem(LS_ORDER) || "null");
      const h = JSON.parse(localStorage.getItem(LS_HIDDEN) || "null");
      if (Array.isArray(o)) setOrder(o.filter((x) => typeof x === "string"));
      if (Array.isArray(h)) setHidden(h.filter((x) => typeof x === "string"));
      if (localStorage.getItem(LS_COLLAPSED) === "1") setCollapsed(true);
    } catch { /* ignore */ }
    setCollapseReady(true);
  }, []);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch {} }, [order, mounted]);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); } catch {} }, [hidden, mounted]);
  useEffect(() => {
    if (!collapseReady) return;
    try { localStorage.setItem(LS_COLLAPSED, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed, collapseReady]);

  // Customize needs the full rail — expand if the user opens it while collapsed.
  useEffect(() => {
    if (customize && collapsed) setCollapsed(false);
  }, [customize, collapsed]);

  // Agent instances are nav items too, so they reorder and hide like the rest.
  // They are merged in rather than hardcoded because they only exist at runtime.
  const agentItems: NavItem[] = [
    ...agents.map((a) => ({
      href: `/agents/${a.id}`,
      label: a.name,
      icon: <Bot size={17} />,
      accent: a.ready ? "#c084fc" : "#fbbf24",
      dim: a.ready ? "rgba(192,132,252,0.16)" : "rgba(251,191,36,0.16)",
    })),
    { href: NEW_AGENT_HREF, label: "New Agent", icon: <Plus size={16} />, accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  ];
  const byHref: Record<string, NavItem> = { ...BY_HREF, ...Object.fromEntries(agentItems.map((i) => [i.href, i])) };
  const defaultOrder = [...agentItems.map((i) => i.href), ...DEFAULT_ORDER];

  // saved order + any nav items not yet in it (new pages, new agents) appended in default position
  const fullOrder = [
    ...order.filter((h) => byHref[h]),
    ...defaultOrder.filter((h) => !order.includes(h)),
  ];
  const visible = customize ? fullOrder : fullOrder.filter((h) => !hidden.includes(h));
  // Group by section. Skins are nested under Agents (not a top-level accordion).
  const sections = SECTION_ORDER.map((sec) => {
    let items = visible.filter((h) => {
      if (sec === "Agents") return h.startsWith("/agents");
      if (SKIN_ROUTES.has(h)) return false;
      return sectionOf(h) === sec;
    });
    if (!customize && sec === "Workspace") {
      const rank = (h: string) => WORKSPACE_ORDER.indexOf(h);
      items = [...items].sort((a, b) => (rank(a) < 0 ? 999 : rank(a)) - (rank(b) < 0 ? 999 : rank(b)));
    }
    return { sec, items };
  });
  const skinItems = visible.filter((h) => SKIN_ROUTES.has(h));

  function move(from: string, to: string) {
    if (from === to) return;
    const next = fullOrder.filter((h) => h !== from);
    const idx = to === "__end__" ? next.length : next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    setOrder(next);
  }
  function toggleHidden(href: string) {
    setHidden((h) => (h.includes(href) ? h.filter((x) => x !== href) : [...h, href]));
  }
  function reset() { setOrder(defaultOrder); setHidden([]); }

  function renderNavItem(href: string, i: number, sec: SectionName, iconOnly = false) {
    const item = byHref[href];
    if (!item) return null;
    // Agent routes match exactly: "/agents/new" is a string prefix of an
    // agent whose id happens to start with "new", and prefix matching
    // would light up both.
    const active = href === "/sen"
      ? activePath.startsWith("/sen") || activePath.startsWith("/firstmate")
      : href === "/" || href.startsWith("/agents")
        ? activePath === href
        : activePath.startsWith(href);
    const isHidden = hidden.includes(href);
    const isOver = overHref === href && dragHref !== href;

    if (customize) {
      return (
        <div
          key={href}
          draggable
          onDragStart={() => setDragHref(href)}
          onDragEnter={() => setOverHref(href)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragHref) move(dragHref, href); setDragHref(null); setOverHref(null); }}
          onDragEnd={() => { setDragHref(null); setOverHref(null); }}
          className="sidebar-item relative group flex items-center gap-2 py-2.5 px-3 mx-2 rounded-lg cursor-grab active:cursor-grabbing"
          style={{
            opacity: dragHref === href ? 0.4 : isHidden ? 0.4 : 1,
            borderTop: isOver ? "2px solid var(--gold)" : "2px solid transparent",
            background: isOver ? "rgba(212,165,116,0.08)" : "transparent",
          }}
        >
          <GripVertical size={14} style={{ color: "var(--cream-mute)" }} className="shrink-0" />
          <span className="shrink-0 grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--cream-dim)" }}>
            {item.icon}
          </span>
          <span className="flex-1 truncate" style={{ textDecoration: isHidden ? "line-through" : "none" }}>{item.label}</span>
          <button
            onClick={() => toggleHidden(href)}
            title={isHidden ? "Show" : "Hide"}
            className="shrink-0 grid place-items-center w-6 h-6 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: isHidden ? "var(--cream-mute)" : "var(--gold)" }}
          >
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      );
    }

    if (iconOnly) {
      return (
        <Link
          key={href}
          href={href}
          title={item.label}
          data-section={sec}
          onClick={() => beginNav?.(href)}
          className={`sidebar-item sidebar-item--rail relative group grid place-items-center w-11 h-11 mx-auto rounded-lg ${active ? "active" : ""}`}
        >
          {active && (
            <motion.span
              layoutId="nav-indicator"
              className="nav-indicator absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[18px] rounded-r-sm"
              style={{ background: "var(--gold)", boxShadow: "0 0 10px var(--gold)" }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <span
            className="nav-icon shrink-0 grid place-items-center w-7 h-7 rounded-md"
            style={{ color: active ? "var(--gold)" : "var(--cream-dim)" }}
          >
            {item.icon}
          </span>
          {item.href === "/automations" && pendingApprovals > 0 && (
            <span
              className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 grid place-items-center rounded-full text-[9px] font-semibold"
              style={{ background: "rgba(251,191,36,0.85)", color: "#1a1408" }}
            >
              {pendingApprovals}
            </span>
          )}
        </Link>
      );
    }

    return (
      <Link
        key={href}
        href={href}
        data-section={sec}
        onClick={() => beginNav?.(href)}
        style={{ animationDelay: `${Math.min(i, 14) * 28}ms` }}
        className={`sidebar-item nav-enter relative group flex items-center gap-3 py-2.5 px-5 ${active ? "active" : ""}`}
      >
        {active && (
          <motion.span
            layoutId="nav-indicator"
            className="nav-indicator absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[22px] rounded-r-sm"
            style={{ background: "var(--gold)", boxShadow: "0 0 10px var(--gold)" }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        <span
          className="nav-icon shrink-0 grid place-items-center w-7 h-7 rounded-md"
          style={{ color: active ? "var(--gold)" : "var(--cream-dim)" }}
        >
          {item.icon}
        </span>
        <span>{item.label}</span>
        {item.href === "/automations" && pendingApprovals > 0 && (
          <span
            title={`${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} waiting in the Inbox`}
            className="ml-auto grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
            style={{ background: "rgba(251,191,36,0.2)", color: "#fbbf24" }}
          >
            {pendingApprovals}
          </span>
        )}
      </Link>
    );
  }

  // Minimized rail: Workspace icons only — expand for the rest of the nav.
  const railItems = (sections.find((s) => s.sec === "Workspace")?.items ?? []).map((href) => ({
    href,
    sec: "Workspace" as SectionName,
  }));

  return (
    <aside
      className={`sidebar-shell hidden md:flex flex-col shrink-0 h-screen overflow-hidden border-r border-[var(--line-soft)] transition-[width] duration-200 ${collapsed ? "sidebar-shell--collapsed w-[68px] py-4" : "w-[244px] py-6"}`}
      style={{ background: "var(--bg-mid)" }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="news-brand news-brand--rail mx-auto mb-4 shrink-0 grid place-items-center w-11 h-11 rounded-xl transition hover:brightness-110"
          title="Expand sidebar"
          aria-label="Expand NEWS OS sidebar"
        >
          <span className="news-nav-icon" aria-hidden="true" />
        </button>
      ) : (
        <div className="news-brand block mb-7 px-5 shrink-0">
          <div className="news-brand-kicker">
            Everything · At Once
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="news-brand-title text-left w-full transition hover:opacity-90"
            aria-label="Minimize sidebar"
            title="Minimize sidebar"
          >
            <span className="news-brand-word">NEWS</span>
            <span className="news-brand-mark-aura" aria-hidden="true">
              <span className="news-brand-mark" />
            </span>
            <span className="news-brand-os">OS</span>
          </button>
          <div className="news-brand-version" title="NEWS OS version">
            ver 1.0.0
          </div>
        </div>
      )}

      {collapsed ? (
        <nav className="flex-1 min-h-0 overflow-y-auto sidebar-scroll flex flex-col gap-0.5 px-2 pb-2">
          {railItems.map(({ href, sec }, i) => renderNavItem(href, i, sec, true))}
        </nav>
      ) : (
      <>
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
      <div className="px-5 pb-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpandedSection("Workspace")}
          aria-expanded={customize || expandedSection === "Workspace"}
          className="sidebar-section-label flex items-center gap-1.5 text-left transition hover:opacity-90 min-w-0"
          style={{ color: expandedSection === "Workspace" && !customize ? "var(--gold)" : undefined }}
        >
          <span>Workspace</span>
          <ChevronDown
            size={14}
            className="shrink-0 transition-transform duration-200"
            style={{
              transform: customize || expandedSection === "Workspace" ? "rotate(180deg)" : "rotate(0deg)",
              color: "var(--cream-mute)",
            }}
          />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {customize && (
            <button onClick={reset} title="Reset to default order" className="text-[9px] uppercase tracking-[0.15em] hover:opacity-100 opacity-70 transition" style={{ color: "var(--cream-dim)" }}>
              Reset
            </button>
          )}
          <button
            onClick={() => setCustomize((c) => !c)}
            title={customize ? "Done customizing" : "Customize sidebar — drag to reorder, hide items"}
            className="grid place-items-center w-6 h-6 rounded-md transition"
            style={{ color: customize ? "var(--gold)" : "var(--cream-dim)", background: customize ? "rgba(212,165,116,0.14)" : "transparent" }}
          >
            {customize ? <Check size={14} /> : <SlidersHorizontal size={14} />}
          </button>
        </div>
      </div>
      {customize && (
        <div className="px-5 pb-2 text-[10px] leading-snug" style={{ color: "var(--cream-mute)" }}>
          Drag <GripVertical size={10} className="inline -mt-0.5" /> to reorder · tap the eye to hide
        </div>
      )}

      <nav className="flex flex-col gap-0.5 relative">
        {sections.map(({ sec, items }, secIdx) => {
          const open = customize || expandedSection === sec;
          const sectionActive = sectionForPath(activePath) === sec;
          // Workspace header lives above the nav (with customize controls).
          const showHeader = sec !== "Workspace";
          return (
            <div key={sec}>
              {showHeader && (
                <button
                  type="button"
                  onClick={() => setExpandedSection(sec)}
                  aria-expanded={open}
                  className={`sidebar-section-label mb-1.5 px-5 w-full flex items-center justify-between gap-2 text-left transition hover:opacity-90 ${secIdx === 0 ? "" : "mt-5"}`}
                  style={{ color: sectionActive ? "var(--gold)" : undefined }}
                >
                  <span>{sec}</span>
                  <ChevronDown
                    size={14}
                    className="shrink-0 transition-transform duration-200"
                    style={{
                      transform: open ? "rotate(180deg)" : "rotate(0deg)",
                      color: "var(--cream-mute)",
                    }}
                  />
                </button>
              )}
              {open && sec === "Agents" && !agents.length && (
                <div className="px-5 pb-1 text-[10.5px] leading-snug" style={{ color: "var(--cream-mute)" }}>
                  No agents yet — create one from a skin.
                </div>
              )}
              {open && items.map((href, i) => renderNavItem(href, i, sec))}
              {open && sec === "Agents" && skinItems.length > 0 && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setSkinsOpen((v) => !v)}
                    aria-expanded={customize || skinsOpen}
                    className="sidebar-section-label mb-1 px-5 w-full flex items-center justify-between gap-2 text-left transition hover:opacity-90"
                    style={{ color: onSkinRoute ? "var(--gold)" : undefined }}
                  >
                    <span>Agent Skins</span>
                    <ChevronDown
                      size={14}
                      className="shrink-0 transition-transform duration-200"
                      style={{
                        transform: customize || skinsOpen ? "rotate(180deg)" : "rotate(0deg)",
                        color: "var(--cream-mute)",
                      }}
                    />
                  </button>
                  {(customize || skinsOpen) && skinItems.map((href, i) => renderNavItem(href, i, "Agents"))}
                </div>
              )}
            </div>
          );
        })}
        {customize && (
          <div
            onDragEnter={() => setOverHref("__end__")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragHref) move(dragHref, "__end__"); setDragHref(null); setOverHref(null); }}
            className="h-6 mx-2 rounded-lg"
            style={{ borderTop: overHref === "__end__" ? "2px solid var(--gold)" : "2px solid transparent" }}
          />
        )}
      </nav>
      </div>

      <div className="shrink-0 pt-6 mx-5 border-t border-[var(--line-soft)]">
        <div className="sidebar-section-label mt-4 mb-2">NEWS OS</div>
        <div className="text-[11px] leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          Bringing complete AI power straight to your hands.
        </div>
      </div>
      </>
      )}
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const nav = useNavPendingOptional();
  const activePath = nav?.displayPath ?? pathname;
  const items = NAV.filter((_, i) => i !== 5 && i !== 6); // hide goals/journal/memory on mobile bar for space
  return (
    <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-40 panel panel-hot px-2 py-1.5 flex gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? activePath === "/" : activePath.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => nav?.beginNav(item.href)}
            className="grid place-items-center w-10 h-10 rounded-lg transition"
            style={{
              background: active ? item.dim : "transparent",
              color: active ? item.accent : "var(--fg-dim)",
            }}
          >
            {item.icon}
          </Link>
        );
      })}
    </nav>
  );
}
