"use client";

// Sen — the crew orchestrator's own page (served at /sen; /firstmate is a
// legacy compatibility alias).
//
// Sen's upstream is a terminal agent distro, not a web app: the primary
// session runs as `claude` inside the clone. This page is its dashboard face,
// organized as sub-tabs the way the Hermes space is:
//
//   Chat     — talk to the primary session through its live Herdr pane
//              (launch it here under a chosen Builder profile if it is not
//              running; the pane is the real terminal, shown as-is)
//   Knowledge Base — upload config .md and reference data (PDF/Excel) for Sen
//   Code Space — embedded Herdr terminal + live pane stats
//   Agent Kanban / Activity Stream / Reports — the fleet's own records, read off disk
//
// Everything except launching/sending in Chat is read-only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAukerPanel } from "../context/sen-panel-context";
import { ContextAwareRightPanel } from "./ContextAwareRightPanel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen, Boxes, Brain, CalendarClock, FileText, LayoutGrid, MessagesSquare, Plus,
  ListTodo, Radio, RefreshCw, Repeat, Send, Square, SquareTerminal, TriangleAlert, PanelLeft, PanelRight, LayoutDashboard, Wrench
} from "lucide-react";
import AgentKanban from "./AgentKanban";
import CodeSpaceView from "./CodeSpaceView";
import BuildersView from "./BuildersView";
import OverviewDashboard from "./Overview";
import McpServersPanel from "./McpServersPanel";
import ActivityStream from "./ActivityStream";
import MemoryPanel from "./MemoryPanel";
import IntegrationsView from "./IntegrationsView";
import SenKnowledgeBase from "./SenKnowledgeBase";
import AutomationsView from "./AutomationsView";
import LoopView from "./LoopView";
import ReleaseGateCard from "./ReleaseGateCard";
import SchedulerQueueCard from "./SchedulerQueueCard";
import PlanningCard from "./PlanningCard";
import ExecutionModePicker from "./ExecutionModePicker";

// Sen's mark is the lotus (cánh sen) emblem — distinct from the NEWS OS diamond.
function SenMark({ size = 16, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className="sen-mark-aura"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/sen-icon.png?v=3"
        alt="Sen"
        width={size}
        height={size}
        className={className}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          // Icon PNG already has a rounded plate — extra radius clips the diamond tip at 32px.
          borderRadius: 0,
          ...style,
        }}
      />
    </span>
  );
}

// --------------------------------------------------------------------- types

interface Home { home: string; found: boolean; version: string | null }
interface Task { id: string; fields: Record<string, string>; mtime: number }
interface BacklogSection { name: string; items: string[] }
interface Report { id: string; title: string; mtime: number }
interface WorkspacePlan { slug: string; title: string; status: string | null; mtime: number; planPath: string; rootLabel: string }
interface PlanReport { id: string; planSlug: string; title: string; mtime: number; reportPath: string }
interface FleetAgent { pane_id?: string; agent?: string; agent_status?: string; cwd?: string; terminal_title?: string; name?: string; label?: string }
interface Fleet {
  status: { installed: boolean; running: boolean; version: string | null; error: string | null };
  workspace: { workspace_id: string; label?: string; pane_count?: number } | null;
  agents: FleetAgent[];
}
interface Overview {
  home: Home;
  captain: string | null;
  backlog: BacklogSection[] | null;
  tasks: Task[];
  reports: Report[];
  plans: WorkspacePlan[];
  planReports: PlanReport[];
  plansRoots: string[];
  fleet: Fleet;
}

type FmTab = "mission" | "knowledge-base" | "automations" | "loop" | "code-space" | "agent-kanban" | "activity-stream" | "reports" | "memory" | "integrations" | "builders";

const FM_TABS: FmTab[] = ["mission", "knowledge-base", "automations", "loop", "code-space", "agent-kanban", "activity-stream", "reports", "memory", "integrations", "builders"];

function normalizeFmTab(raw: string | null): FmTab | null {
  if (!raw) return null;
  if (raw === "fleet") return "code-space";
  if (raw === "tasks") return "agent-kanban";
  if (raw === "backlog") return "activity-stream";
  if (raw === "llmops") return "memory";
  // Agent tab removed — chat + sessions/MCP already live on the main Sen surface.
  if (raw === "agent") return "mission";
  if (raw === "overview") return "knowledge-base";
  return FM_TABS.includes(raw as FmTab) ? (raw as FmTab) : null;
}

function parseAukerLocation(): { tab: FmTab; session: string | null; openPanel: boolean } {
  if (typeof window === "undefined") return { tab: "mission", session: null, openPanel: false };
  const params = new URLSearchParams(window.location.search);
  const t = normalizeFmTab(params.get("tab"));
  const session = params.get("session");
  const validSession = session && /^s-[A-Za-z0-9_-]+$/.test(session) ? session : null;
  if (validSession) return { tab: "mission", session: validSession, openPanel: true };
  if (t) return { tab: t, session: null, openPanel: true };
  return { tab: "mission", session: null, openPanel: false };
}

// The chat worker sticks across navigation and reloads — leaving the page and
// coming back must find the same worker answering, not a surprise default.
// legacy compatibility key: persisted in browsers before the Sen rename.
const LS_BUILDER = "agentos.firstmate.builder";
// The conversation you were in sticks too — same reason as the worker.
// legacy compatibility key: persisted in browsers before the Sen rename.
const LS_SESSION = "agentos.firstmate.session";
// The chatbot channel is harness-agnostic — runBuilderChat speaks every
// catalog CLI's protocol — so the picker offers every Builder, not just the
// harnesses Sen verifies for its interactive primary session.

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------ chrome

function Card({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="aura-border aura-border--soft rounded-xl border p-4" style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-[13px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>{children}</p>;
}

function ReportsAndPlanContent({
  reports,
  plans,
  planReports,
  plansRoots,
  homeFound,
}: {
  reports: Report[];
  plans: WorkspacePlan[];
  planReports: PlanReport[];
  plansRoots: string[];
  homeFound: boolean;
}) {
  const plansPathHint = plansRoots[0] ?? "plans";
  return (
    <div className="space-y-4">
      <ReleaseGateCard />
      <SchedulerQueueCard />
      <Card title="Plans" icon={<FileText size={14} />}>
        {plans.length === 0 ? (
          <Empty>
            No plans yet — folders with <code>plan.md</code> under{" "}
            <code>{plansPathHint.replace(/\\/g, "/")}</code> appear here.
          </Empty>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {plans.map((p) => (
              <li key={`${p.rootLabel}/${p.slug}`} className="flex items-start gap-3">
                <span className="font-medium truncate min-w-0">{p.title}</span>
                {p.status && (
                  <span className="shrink-0 text-[10px] uppercase px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
                    {p.status}
                  </span>
                )}
                <code className="ml-auto shrink-0 truncate max-w-[40%]" style={{ color: "var(--fg-dim)" }} title={p.planPath}>
                  {p.rootLabel}/{p.slug}
                </code>
                <span className="shrink-0" style={{ color: "var(--fg-dim)" }}>{fmtTime(p.mtime)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {planReports.length > 0 && (
        <Card title={"Plan reports" + (planReports.length ? ` (${planReports.length})` : "")} icon={<FileText size={14} />}>
          <ul className="space-y-1.5 text-[13px]">
            {planReports.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <span className="font-medium truncate">{r.title}</span>
                <code style={{ color: "var(--fg-dim)" }}>{r.planSlug}</code>
                <span className="ml-auto shrink-0" style={{ color: "var(--fg-dim)" }}>{fmtTime(r.mtime)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={"Scout reports" + (reports.length ? ` (${reports.length})` : "")} icon={<FileText size={14} />}>
        {!homeFound ? (
          <Empty>Sen home not installed — scout reports need <code>data/&lt;task&gt;/report.md</code> under FM_HOME.</Empty>
        ) : reports.length === 0 ? (
          <Empty>No scout reports yet — they land at <code>data/&lt;task&gt;/report.md</code>.</Empty>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <span className="font-medium truncate">{r.title}</span>
                <code style={{ color: "var(--fg-dim)" }}>{r.id}</code>
                <span className="ml-auto shrink-0" style={{ color: "var(--fg-dim)" }}>{fmtTime(r.mtime)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ chat tab

interface ChatTurn { role: "user" | "assistant"; text: string; ts?: string; builder?: string; model?: string; effort?: string | null; usage?: { input?: number; output?: number; thinking?: number } | null }

/** 21348 → "21.3k" — token counts stay readable in the per-turn badge. */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
interface BuilderRow { id: string; cli: string; name: string; model?: string | null; effort?: string | null; verifiedAt?: string; verifiedDetail?: string; quota?: { text: string; checkedAt: string } }
interface SessionMeta { id: string; title: string; createdAt: string; updatedAt: string; builder?: string; model?: string; goalId?: string }

const SUGGESTIONS = [
  "ahoy! Đọc AGENTS.md và tự giới thiệu bạn làm được gì",
  "Lập kế hoạch một scout task cho repo này",
  "Kiểm tra toolchain của fleet và báo cáo tình trạng",
];

/**
 * Sen as a chatbot — bubbles, streaming text, and a ChatGPT-style session
 * list on the left. The channel is POST /api/sen/chat: a headless turn of
 * the chosen worker's CLI inside the upstream firstmate home. Each
 * session is its own transcript; the current one sticks across navigation.
 */
function ChatTab({
  initialSessionId,
  sidePanel,
  initialShowLeft = true,
  initialShowRight = false,
}: {
  initialSessionId?: string | null;
  sidePanel?: React.ReactNode | ((props: { showRight: boolean; toggleRight: () => void; fallbackSelects: React.ReactNode }) => React.ReactNode);
  initialShowLeft?: boolean;
  initialShowRight?: boolean;
}) {
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(850);
  // Keep the info panel proportional: 850px on wide screens, but never more
  // than 40vw (floor 320px) so the chat composer stays usable on smaller
  // viewports — a fixed 850px crushed it to zero width at 1280px.
  useEffect(() => {
    const clamp = () => setRightWidth((w) => Math.min(w, Math.max(320, Math.floor(window.innerWidth * 0.4))));
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  // Sessions / Artifacts / MCP — default 50 · 25 · 25, drag to retune.
  const [railSplit, setRailSplit] = useState<[number, number, number]>([50, 25, 25]);
  const [railSplitReady, setRailSplitReady] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [showLeft, setShowLeft] = useState(initialShowLeft);
  // Deep-linked panels open after mount, not in the initial render: deriving
  // this from the URL during hydration renders an aside the server HTML does
  // not have (React hydration error #418 on /sen?tab=… deep links).
  const [showRight, setShowRight] = useState(false);
  const [autoClosed, setAutoClosed] = useState<"left" | "right" | null>(null);
  useEffect(() => {
    if (!initialShowRight) return;
    // Same choreography as toggleRight: on narrower screens the left rail
    // yields to the panel instead of leaving the chat column too cramped for
    // its own header controls.
    if (initialShowLeft && window.innerWidth < 1500) {
      setShowLeft(false);
      setAutoClosed("left");
    }
    setShowRight(true);
    // Mount-only: applies the deep-linked panel once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShowRight, initialShowLeft]);
  const { isOpen, mode, togglePanel } = useAukerPanel();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("agentos.sen.rail-split");
      if (raw) {
        const parsed = JSON.parse(raw) as number[];
        if (
          Array.isArray(parsed) && parsed.length === 3
          && parsed.every((n) => typeof n === "number" && n >= 10 && n <= 80)
        ) {
          const sum = parsed[0] + parsed[1] + parsed[2];
          if (sum > 0) setRailSplit([parsed[0] * 100 / sum, parsed[1] * 100 / sum, parsed[2] * 100 / sum]);
        }
      }
    } catch { /* ignore */ }
    setRailSplitReady(true);
  }, []);
  useEffect(() => {
    if (!railSplitReady) return;
    try { localStorage.setItem("agentos.sen.rail-split", JSON.stringify(railSplit)); } catch { /* ignore */ }
  }, [railSplit, railSplitReady]);

  const effectiveShowRight = showRight || isOpen;
  const stateRef = useRef({ showLeft, showRight: effectiveShowRight, autoClosed });
  stateRef.current = { showLeft, showRight, autoClosed };

  const toggleLeft = useCallback(() => {
    const { showLeft: l, showRight: r, autoClosed: a } = stateRef.current;
    if (!l) {
      if (r && a !== "left") {
        setShowRight(false);
        setAutoClosed("right");
      } else {
        setAutoClosed(null);
      }
      setShowLeft(true);
    } else {
      setAutoClosed(null);
      setShowLeft(false);
    }
  }, []);

  const toggleRight = useCallback(() => {
    const { showLeft: l, showRight: r, autoClosed: a } = stateRef.current;
    if (!r) {
      if (l && a !== "right") {
        setShowLeft(false);
        setAutoClosed("left");
      } else {
        setAutoClosed(null);
      }
      setShowRight(true);
    } else {
      setAutoClosed(null);
      setShowRight(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleLeft();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function startRailResize(boundary: 0 | 1, ev: React.MouseEvent<HTMLDivElement>) {
    ev.preventDefault();
    const startY = ev.clientY;
    const start = [...railSplit] as [number, number, number];
    const totalH = railRef.current?.clientHeight ?? 0;
    if (totalH < 80) return;
    const minPct = 12;
    const onMove = (move: MouseEvent) => {
      const dPct = ((move.clientY - startY) / totalH) * 100;
      const a = boundary;
      const b = boundary + 1;
      const pair = start[a] + start[b];
      let na = Math.min(pair - minPct, Math.max(minPct, start[a] + dPct));
      let nb = pair - na;
      const next: [number, number, number] = [...start];
      next[a] = na;
      next[b] = nb;
      setRailSplit(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResize(which: "left" | "right", ev: React.MouseEvent<HTMLDivElement>) {
    ev.preventDefault();
    const startX = ev.clientX;
    const start = which === "left" ? leftWidth : rightWidth;
    const onMove = (move: MouseEvent) => {
      const delta = move.clientX - startX;
      if (which === "left") setLeftWidth(Math.max(150, Math.min(360, start + delta)));
      else setRightWidth(Math.max(260, Math.min(window.innerWidth * 0.7, start - delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [activity, setActivity] = useState("");
  // Accumulated thinking text for `thought` events — the activity line shows
  // the rolling tail, reset per turn.
  const thoughtRef = useRef("");
  // Set by a "Tiếp quản" switch: the NEXT sent turn carries the handoff
  // marker so the route packs a structured handoff, not a raw transcript.
  const handoffNextRef = useRef<{ fromName: string; fromCli: string } | null>(null);
  const [lastTiming, setLastTiming] = useState<{ ttfb: number | null; ms: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<{ data: string; mimeType: string; preview: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [builders, setBuilders] = useState<BuilderRow[]>([]);
  const [builderId, setBuilderId] = useState<string>("");
  const [switching, setSwitching] = useState(false);
  const [pendingBuilder, setPendingBuilder] = useState("");
  // Worker tự động tiếp quản khi worker hiện tại chết quota (server-side config).
  const [fallbackChain, setFallbackChain] = useState<string[]>([]);
  // Offer to schedule a wake-up when the whole chain is quota-dead.
  const [resetOffer, setResetOffer] = useState<{ at: string; worker: string } | null>(null);
  const wakeAnnouncedRef = useRef("");
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  /** The worker recorded on the open session (may name a deleted profile). */
  const [sessionBuilder, setSessionBuilder] = useState<string | null>(null);
  /** The model the CLI itself reported answering with (lane-confirmed). */
  const [actualModel, setActualModel] = useState<string | null>(null);
  const [modelList, setModelList] = useState<{ models: { id: string; note?: string }[]; cliDefault: string | null } | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [pendingModel, setPendingModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [kanbanSaving, setKanbanSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const queuedRef = useRef<string | null>(null);

  // Drain the queued message when the turn finishes.
  useEffect(() => {
    if (streaming || !queuedRef.current) return;
    const q = queuedRef.current;
    queuedRef.current = null;
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Only green-ticked workers (verifiedAt set in CLI Config) may be picked —
  // the same rule the Agents create flow applies.
  const verified = builders.filter((b) => b.verifiedAt);

  const loadSessions = useCallback(async () => {
    const j = await fetch("/api/sen/chat", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setSessions(Array.isArray(j.sessions) ? j.sessions : []);
  }, []);

  const loadTurns = useCallback(async (sid: string) => {
    const j = await fetch(`/api/sen/chat?session=${encodeURIComponent(sid)}`, { cache: "no-store" })
      .then((r) => r.json()).catch(() => ({}));
    setTurns(Array.isArray(j.turns) ? j.turns : []);
    setSessionModel(typeof j.model === "string" && j.model ? j.model : null);
    setSessionBuilder(typeof j.builder === "string" && j.builder ? j.builder : null);
    // A session remembers the worker that last answered it — reopening one
    // restores that worker, not whatever was selected elsewhere. A deleted
    // worker is left for the honesty effect + banner below.
    if (typeof j.builder === "string" && j.builder) {
      setBuilderId((current) => {
        if (current === j.builder) return current;
        try { localStorage.setItem(LS_BUILDER, j.builder); } catch { /* private mode */ }
        return j.builder;
      });
    }
  }, []);

  // A Kanban card may link to an internal session that is intentionally not in
  // the ordinary chat list. The direct GET remains authoritative, so adopt the
  // query id even when the left rail does not contain it.
  useEffect(() => {
    if (!initialSessionId || initialSessionId === sessionId) return;
    setSessionId(initialSessionId);
    try { localStorage.setItem(LS_SESSION, initialSessionId); } catch { /* private mode */ }
    setNotes([]);
    void loadTurns(initialSessionId);
  }, [initialSessionId, loadTurns, sessionId]);

  useEffect(() => {
    let activeSid = initialSessionId ?? null;
    if (!activeSid) {
      try { activeSid = localStorage.getItem(LS_SESSION); } catch { /* private mode */ }
    }
    if (activeSid) {
      setSessionId(activeSid);
      void loadTurns(activeSid);
    } else {
      setTurns([]);
    }

    try {
      const savedB = localStorage.getItem(LS_BUILDER);
      if (savedB) setBuilderId(savedB);
    } catch { /* private mode */ }

    void loadSessions();
    fetch("/api/builders", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBuilders((j.builders ?? []) as BuilderRow[]))
      .catch(() => {});
    fetch("/api/sen/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setFallbackChain(Array.isArray(j.fallbackBuilders) ? j.fallbackBuilders.map(String) : []);
        if (j.wakeResult?.firedAt) wakeAnnouncedRef.current = String(j.wakeResult.firedAt);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the wake result: a scheduled probe fired while the page was open.
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/sen/config", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          const w = j.wakeResult;
          if (!w?.firedAt || String(w.firedAt) === wakeAnnouncedRef.current) return;
          if (Date.now() - Date.parse(String(w.firedAt)) > 15 * 60_000) return;
          wakeAnnouncedRef.current = String(w.firedAt);
          setNotes((n) => [...n, w.back?.length
            ? `Wake probe: quota ĐÃ HỒI cho ${w.back.join(", ")}${w.stillDead?.length ? ` — vẫn chết: ${w.stillDead.join(", ")}` : ""}. Có thể chat lại bình thường.`
            : `Wake probe: chuỗi dự phòng vẫn chưa hồi quota${w.stillDead?.length ? ` (${w.stillDead.join(", ")})` : ""}.`]);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Keep the worker selection honest: if the remembered/current worker is not
  // verified (lost its tick, or was deleted), move to the first verified one.
  useEffect(() => {
    if (!builders.length) return;
    if (!verified.some((b) => b.id === builderId)) {
      const next = verified[0]?.id ?? "";
      setBuilderId(next);
      try { next ? localStorage.setItem(LS_BUILDER, next) : localStorage.removeItem(LS_BUILDER); } catch { /* private mode */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builders]);

  const pick = (sid: string) => {
    if (streaming || sid === sessionId) return;
    setSessionId(sid);
    try { localStorage.setItem(LS_SESSION, sid); } catch { /* private mode */ }
    setNotes([]);
    void loadTurns(sid);
  };

  const newChat = useCallback(() => {
    if (streaming) return;
    setSessionId(null);
    try { localStorage.removeItem(LS_SESSION); } catch { /* private mode */ }
    setTurns([]);
    setNotes([]);
    setSessionModel(null);
    setSessionBuilder(null);
    setActualModel(null);
    areaRef.current?.focus();
  }, [streaming]);

  const removeSession = async (sid: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    await fetch(`/api/sen/chat?session=${encodeURIComponent(sid)}`, { method: "DELETE" }).catch(() => {});
    if (sid === sessionId) newChat();
    void loadSessions();
  };

  const confirmSwitch = (mode?: "new" | "takeover") => {
    if (!pendingBuilder || pendingBuilder === builderId) { setSwitching(false); return; }
    const nextName = builders.find((b) => b.id === pendingBuilder)?.name ?? pendingBuilder;
    const prevName = builders.find((b) => b.id === builderId)?.name ?? builderId;
    // Quy tắc mềm: đổi CLI (kimi → codex…) mặc định mở chat mới — CLI mới không
    // resume được session của CLI cũ, transcript phải đóng gói gửi lại (cold
    // start, tốn token, khó audit). NHƯNG khi worker hiện tại hết quota/chết,
    // CLI khác phải tiếp quản được: user chọn "takeover" và transcript được
    // đóng gói sang worker mới, session giữ nguyên.
    const currentCli = builders.find((b) => b.id === builderId)?.cli;
    const nextCli = builders.find((b) => b.id === pendingBuilder)?.cli;
    const cliChange = Boolean(sessionId && currentCli && nextCli && currentCli !== nextCli);
    setBuilderId(pendingBuilder);
    try { localStorage.setItem(LS_BUILDER, pendingBuilder); } catch { /* private mode */ }
    setSwitching(false);
    // A model picked for one CLI rarely names a valid model on another.
    setSessionModel(null);
    setActualModel(null);
    if (cliChange && mode !== "takeover") {
      setSessionId(null);
      try { localStorage.removeItem(LS_SESSION); } catch { /* private mode */ }
      setTurns([]);
      setSessionBuilder(null);
      setNotes((n) => [...n, `Đổi CLI (${currentCli} → ${nextCli}) — mở chat mới với ${nextName} để transcript không bị đóng gói gửi lại. Session cũ vẫn ở panel bên trái.`]);
      areaRef.current?.focus();
      return;
    }
    // Bind the open session to the new worker immediately — reopening it later
    // must find this worker, even if no turn is sent in between.
    if (sessionId) {
      fetch("/api/sen/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId, builderId: pendingBuilder }),
      }).then(() => loadSessions()).catch(() => {});
    }
    setNotes((n) => [...n, cliChange
      ? `${nextName} tiếp quản session (từ ${currentCli}). Turn đầu của worker mới sẽ nhận handoff có cấu trúc — context giữ lại, tốn token gửi lại một lần.`
      : `Switched worker → ${nextName}. The transcript carries on; the next turn bills the new worker.`]);
    // The next turn is the takeover turn — mark it so the route packs the
    // structured handoff. One-shot: consumed by the next send().
    if (cliChange && mode === "takeover") {
      handoffNextRef.current = { fromName: prevName, fromCli: currentCli! };
    }
  };

  const openModelSwitch = async () => {
    setPendingModel(sessionModel ?? "");
    setCustomModel("");
    setSwitchingModel(true);
    const j = await fetch(`/api/sen/models?builder=${encodeURIComponent(builderId)}`, { cache: "no-store" })
      .then((r) => r.json()).catch(() => ({}));
    setModelList({ models: Array.isArray(j.models) ? j.models : [], cliDefault: j.cliDefault ?? null });
  };

  const confirmModel = async () => {
    const chosen = (customModel.trim() || pendingModel).trim() || null;
    setSwitchingModel(false);
    setSessionModel(chosen);
    if (!sessionId) {
      const q = builders.find((b) => b.id === builderId)?.quota;
      const usage = q?.text ? `Usage còn: ${q.text}` : "chưa có số liệu usage — chạy health probe ở CLI Config để đo";
      setNotes((n) => [...n, `Model → ${chosen ?? "CLI default"} · ${usage}`]);
      return;
    }
    const j = await fetch("/api/sen/chat", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionId, model: chosen }),
    }).then((r) => r.json()).catch(() => ({}));
    const inUse = j.model ?? chosen ?? "CLI default";
    const usage = j.usage?.text
      ? `Usage còn: ${j.usage.text} (đo ${j.usage.checkedAt ? new Date(j.usage.checkedAt).toLocaleString() : "gần đây"})`
      : "chưa có số liệu usage — chạy health probe ở CLI Config để đo";
    setNotes((n) => [...n, `Model → ${inUse} · ${usage}`]);
    void loadSessions();
  };

  // The CLI said it itself: this worker's login died mid-conversation.
  const loginWall = (turns ?? []).some((t) => t.role === "assistant" && /not logged in|no model configured|run \/login|use \/login/i.test(t.text));
  // The session's recorded worker no longer exists — offer a rebind instead of
  // letting the user discover the 409 at send time.
  const staleWorker = Boolean(
    sessionId && sessionBuilder && builders.length > 0 && !builders.some((b) => b.id === sessionBuilder),
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, notes]);

  const send = async (text?: string) => {
    let prompt = (text ?? draft).trim();
    if (!prompt && images.length) prompt = "Mô tả ảnh này.";
    if (!prompt) return;
    // Queue one message while a turn runs — Enter during streaming used to
    // vanish. It goes out automatically when the turn finishes.
    if (streaming) {
      queuedRef.current = prompt;
      setDraft("");
      setImages([]);
      setNotes((n) => [...n, "Đã xếp vào hàng đợi — gửi khi lượt này xong."]);
      return;
    }
    if (!builderId) return;
    setDraft("");
    setImages([]);
    setActivity("");
    thoughtRef.current = "";
    setStreaming(true);
    setNotes([]);
    setTurns((t) => [...(t ?? []), { role: "user", text: prompt }, { role: "assistant", text: "" }]);
    const ctl = new AbortController();
    abortRef.current = ctl;
    // Consume the one-shot takeover marker into THIS turn's payload.
    const handoff = handoffNextRef.current;
    handoffNextRef.current = null;
    try {
      const res = await fetch("/api/sen/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt, builderId, session: sessionId ?? undefined, model: sessionModel ?? undefined,
          ...(handoff ? { handoff } : {}),
          ...(images.length ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) } : {}),
        }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(String(j.error ?? `HTTP ${res.status}`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let e: { t?: string; c?: string; m?: string; id?: string; ok?: boolean; error?: string | null; builder?: string; model?: string; text?: string; checkedAt?: string; ms?: number; ttfb?: number | null; effort?: string | null; usage?: { input?: number; output?: number; thinking?: number } | null; at?: string; worker?: string };
          try { e = JSON.parse(line); } catch { continue; }
          if (e.t === "session" && e.id) {
            setSessionId(e.id);
            try { localStorage.setItem(LS_SESSION, e.id); } catch { /* private mode */ }
          } else if (e.t === "d" && e.c) {
            setTurns((t) => {
              const next = [...(t ?? [])];
              const last = next[next.length - 1];
              
              if (last?.role === "assistant") {
                const newText = last.text + e.c;
                next[next.length - 1] = { ...last, text: newText };
                
                // --- Zero-UI Trigger Parser ---
                const match = newText.match(new RegExp("<panel_command>(kanban|mission-control|memory|dify|cli-config|code-space|<closed>)<\/panel_command>", "i"));
                if (match) {
                  const command = match[1].toLowerCase();
                  if (command === '<closed>') togglePanel('closed');
                  else togglePanel(command as any);
                  
                  // Optional: remove command from visible text if desired
                  // next[next.length - 1].text = newText.replace(match[0], '');
                }
              }

              return next;
            });
          } else if (e.t === "activity" && e.c) {
            setActivity(String(e.c));
          } else if (e.t === "thought" && e.c) {
            // Raw thinking chunks (kimi ACP emits these alongside the activity
            // line) — same single rolling line, never a second one.
            thoughtRef.current += String(e.c);
            const tail = thoughtRef.current.replace(/\s+/g, " ").trim().slice(-80);
            if (tail) setActivity(`đang nghĩ: ${tail}`);
          } else if (e.t === "note" && e.c) {
            // A resume fallback means the partial text streamed so far belongs
            // to a dead attempt — the fresh turn is about to re-answer.
            if (/could not be resumed/i.test(String(e.c))) {
              setTurns((t) => {
                const next = [...(t ?? [])];
                const last = next[next.length - 1];
                if (last?.role === "assistant") next[next.length - 1] = { ...last, text: "" };
                return next;
              });
            }
            setNotes((n) => [...n, String(e.c)]);
          } else if (e.t === "error" && e.m) {
            setNotes((n) => [...n, `Error: ${e.m}`]);
          } else if (e.t === "final" && e.ok === false && e.error) {
            setNotes((n) => [...n, `Stopped: ${e.error}`]);
          } else if (e.t === "final" && e.model) {
            setActualModel(String(e.model));
            setTurns((t) => {
              const next = [...(t ?? [])];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, builder: typeof e.builder === "string" ? e.builder : builderId, model: String(e.model), effort: e.effort ?? null, usage: e.usage ?? null };
              return next;
            });
          } else if (e.t === "final" && typeof e.ms === "number") {
            setLastTiming({ ttfb: typeof e.ttfb === "number" ? e.ttfb : null, ms: e.ms });
            // A model-less final (headless lane) still carries effort/usage.
            if (e.effort || e.usage) {
              setTurns((t) => {
                const next = [...(t ?? [])];
                const last = next[next.length - 1];
                if (last?.role === "assistant") next[next.length - 1] = { ...last, builder: typeof e.builder === "string" ? e.builder : builderId, effort: e.effort ?? null, usage: e.usage ?? null };
                return next;
              });
            }
          } else if (e.t === "reset-offer" && e.at) {
            setResetOffer({ at: String(e.at), worker: String(e.worker ?? "") });
          } else if (e.t === "quota" && e.text) {
            // Fresh post-turn usage — the chip tooltip and the next switch-model
            // report read this instead of the stale probe.
            setBuilders((bs) => bs.map((b) => b.id === builderId
              ? { ...b, quota: { text: String(e.text), checkedAt: String(e.checkedAt ?? "") } }
              : b));
          }
        }
      }
      void loadSessions();
    } catch (err) {
      // An abort is the Stop button, not a failure — the server killTrees the
      // worker on disconnect, so nothing keeps billing.
      if (err instanceof Error && err.name === "AbortError") {
        setNotes((n) => [...n, "Stopped — the turn was killed."]);
      } else {
        setNotes((n) => [...n, `Error: ${String(err instanceof Error ? err.message : err)}`]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setTurns((t) => (t ?? []).filter((x, i, arr) => !(i === arr.length - 1 && x.role === "assistant" && !x.text.trim())));
      areaRef.current?.focus();
    }
  };

  const empty = turns !== null && turns.length === 0;

  const sendToKanban = async () => {
    if (!sessionId || !turns?.length || kanbanSaving) return;
    const meta = sessions.find((session) => session.id === sessionId);
    const firstGoal = turns.find((turn) => turn.role === "user")?.text.trim() ?? "";
    const title = (meta?.title || firstGoal || "Sen task").replace(/\s+/g, " ").slice(0, 120);

    setKanbanSaving(true);
    try {
      // Phase 12: a goal-linked session hands off to the canonical create —
      // the card references the goal and carries a brief REFERENCE, never
      // raw transcript text (privacy rule). Legacy sessions keep the raw
      // brief during the migration window.
      const goalId = meta?.goalId;
      const recent = turns
        .filter((turn) => turn.text.trim())
        .slice(-6)
        .map((turn) => `${turn.role === "user" ? "User" : "Sen"}: ${turn.text.trim().replace(/\s+/g, " ").slice(0, 320)}`)
        .join("\n");
      const legacyBrief = [
        firstGoal ? `Goal: ${firstGoal.replace(/\s+/g, " ").slice(0, 500)}` : "",
        recent ? `Recent context:\n${recent}` : "",
      ].filter(Boolean).join("\n\n").slice(0, 1800);

      const response = await fetch("/api/agent-kanban/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(goalId
          ? {
              title,
              goalId,
              briefRef: `session:${sessionId}`,
              // The legacy fallback drops goalId/briefRef; keep the session
              // pointer as the brief so the link survives either way.
              brief: `session:${sessionId}`,
              workflowStage: "backlog",
              source: { kind: "firstmate", sessionId },
            }
          : {
              title,
              brief: legacyBrief || title,
              workflowStage: "backlog",
              source: { kind: "firstmate", sessionId },
            }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      // Key the note off the route's canonical marker, not the request —
      // a goal-linked handoff can still land on the legacy board while the
      // Go control plane is unconfigured.
      setNotes((current) => [...current, body.canonical
        ? "Handed off to the canonical board (goal-linked)."
        : "Added to Agent Kanban backlog."]);
    } catch (error) {
      setNotes((current) => [...current, `Could not add to Kanban: ${String(error instanceof Error ? error.message : error)}`]);
    } finally {
      setKanbanSaving(false);
    }
  };

  const fallbackSelects = (
    <div className="flex gap-1.5 shrink-0">
      {[0, 1, 2].slice(0, Math.min(fallbackChain.length + 1, 3)).map((i) => (
        <select
          key={i}
          value={fallbackChain[i] ?? ""}
          onChange={async (ev) => {
            const id = ev.target.value;
            const chain = [...fallbackChain];
            if (id) chain[i] = id;
            else chain.splice(i, 1);
            const next = chain.filter(Boolean).slice(0, 3);
            setFallbackChain(next);
            const r = await fetch("/api/sen/config", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fallbackBuilders: next }),
            }).catch(() => null);
            if (r && !r.ok) {
              const j = await r.json().catch(() => ({}));
              setNotes((n) => [...n, `Không đặt được chuỗi dự phòng: ${String(j.error ?? r.status)}`]);
            } else {
              setNotes((n) => [...n, next.length
                ? `Chuỗi dự phòng: ${next.map((x) => builders.find((b) => b.id === x)?.name ?? x).join(" → ")}.`
                : "Đã tắt tự động tiếp quản."]);
            }
          }}
          className="px-1.5 py-1 rounded-lg border text-[11px] max-w-[120px] truncate"
          style={{ borderColor: fallbackChain[i] ? "rgba(125,211,252,0.5)" : "var(--panel-border)", color: "var(--fg-dim)", background: "transparent" }}
          title={`Dự phòng ${i + 1} — TỰ ĐỘNG tiếp quản theo thứ tự khi worker chết quota, hoặc SỚM khi quota còn ~10%. Hết chuỗi thì báo quota hồi sớm nhất + hẹn lịch wake.`}
        >
          <option value="" style={{ background: "#1e1e1e" }}>{i === 0 && fallbackChain.length === 0 ? "Dự phòng: tắt" : `DP${i + 1}: —`}</option>
          {verified.filter((b) => b.id !== builderId && !fallbackChain.includes(b.id)).map((b) => (
            <option key={b.id} value={b.id} style={{ background: "#1e1e1e" }}>{b.name}</option>
          ))}
        </select>
      ))}
    </div>
  );

  return (
    <div className="firstmate-surface aura-border aura-border--soft flex rounded-xl border overflow-hidden" style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))", height: "calc(100vh - 32px)", minHeight: 420 }}>
      {/* sessions panel — the ChatGPT-style left rail */}
      {showLeft && (
      <div className="shrink-0 flex flex-col border-r" style={{ width: leftWidth, borderColor: "var(--panel-border)" }}>
        <div className="flex flex-col gap-4 p-4 pb-0">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLeft}
              className="-ml-1 p-1.5 rounded-md hover:bg-white/5 transition-colors shrink-0"
              style={{ color: "var(--fg-dim)" }}
              title="Toggle Sidebar Ctrl+B"
            >
              <PanelLeft size={16} />
            </button>
            <SenMark size={44} />
            <span className="text-2xl font-semibold tracking-tight">Sen</span>
          </div>
        </div>
        <div ref={railRef} className="flex-1 min-h-0 flex flex-col px-2 pt-3 pb-2">
          <div className="min-h-0 flex flex-col" style={{ flex: `${railSplit[0]} 1 0` }}>
            <section className="panel p-3 flex flex-col gap-2 h-full min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <h2 className="flex items-center gap-2 text-[12px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
                  <MessagesSquare size={13} /> Sessions
                </h2>
                <button
                  onClick={newChat}
                  disabled={streaming}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition hover:brightness-110 disabled:opacity-50"
                  style={{ background: "rgba(125,211,252,0.14)", color: "#7dd3fc" }}
                >
                  <Plus size={11} /> New
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 sidebar-scroll">
                {sessions.length === 0 && (
                  <div className="text-[11.5px] text-[var(--cream-mute)]">
                    No past sessions yet — a conversation lands here after its first turn.
                  </div>
                )}
                {sessions.map((s) => {
                  const active = s.id === sessionId;
                  const workerName = s.builder
                    ? (builders.find((b) => b.id === s.builder)?.name ?? s.builder)
                    : null;
                  return (
                    <div key={s.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => pick(s.id)}
                        disabled={streaming}
                        className="w-full text-left rounded-lg border p-2 transition hover:brightness-125 disabled:opacity-50"
                        style={{
                          borderColor: active ? "var(--gold)" : "var(--line-soft)",
                          background: active ? "rgba(212,165,116,0.08)" : "transparent",
                        }}
                      >
                        <div className="text-[12px] truncate pr-4" style={{ color: "var(--cream)" }} title={s.title}>
                          {s.title || "(no prompt)"}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--cream-mute)] truncate">
                          {workerName ? `${workerName} · ` : ""}
                          {new Date(s.updatedAt).toLocaleString()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void removeSession(s.id, e)}
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 px-1 rounded text-[12px] transition"
                        style={{ color: "var(--cream-mute)" }}
                        title="Delete this conversation"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div
            className="panel-resizer-row"
            onMouseDown={(e) => startRailResize(0, e)}
            title="Drag to resize Sessions / Artifacts"
          />

          <div className="min-h-0 flex flex-col" style={{ flex: `${railSplit[1]} 1 0` }}>
            <section className="panel p-3 flex flex-col gap-2 h-full min-h-0 overflow-hidden">
              <h2 className="flex items-center gap-2 text-[12px] font-medium tracking-wide uppercase shrink-0" style={{ color: "var(--fg-dim)" }}>
                <FileText size={13} /> Artifacts
              </h2>
              <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
                <p className="text-[11.5px] text-[var(--cream-mute)]">
                  Files from deliverable runs land here when you use the Sen agent panel.
                </p>
              </div>
            </section>
          </div>

          <div
            className="panel-resizer-row"
            onMouseDown={(e) => startRailResize(1, e)}
            title="Drag to resize Artifacts / MCP"
          />

          <div className="min-h-0 flex flex-col" style={{ flex: `${railSplit[2]} 1 0` }}>
            <McpServersPanel compact className="h-full" />
          </div>
        </div>
      </div>
      )}
      {showLeft && <div className="panel-resizer" onMouseDown={(e) => startResize("left", e)} title="Drag to resize session panel" />}

      {/* chat column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="relative flex items-center gap-2 px-4 py-2.5 border-b overflow-visible" style={{ borderColor: "var(--panel-border)" }}>
          {!showLeft && (
            <button
              onClick={() => setShowLeft((v) => !v)}
              className="mr-1 -ml-2 p-1.5 rounded-md hover:bg-white/5 transition-colors shrink-0"
              style={{ color: "var(--fg-dim)" }}
              title="Toggle Sidebar Ctrl+B"
            >
              <PanelLeft size={16} />
            </button>
          )}
          <span
            className="px-2 py-1 rounded-lg border text-[12px] shrink-0"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
            title={builders.find((b) => b.id === builderId)?.quota?.text ?? "The worker answering this chat — green-ticked in CLI Config"}
          >
            {builders.length === 0 ? "checking workers…" : builders.find((b) => b.id === builderId)?.name ?? (verified.length ? "…" : "no verified worker")}
            {builders.length > 0 && builderId && " ✓"}
            {(() => {
              const q = builders.find((b) => b.id === builderId)?.quota?.text;
              const pct = q?.match(/(\d+%)/)?.[1];
              return pct ? <span className="ml-1" style={{ color: "#7dd3fc" }}>· {pct}</span> : null;
            })()}
          </span>
          <div className="relative shrink-0">
            <button
              onClick={() => { setPendingBuilder(builderId); setSwitching((v) => !v); setSwitchingModel(false); }}
              disabled={streaming || builders.length === 0 || verified.length < 1}
              className="px-2.5 py-1 rounded-lg border text-[12px]"
              style={{ borderColor: switching ? "#7dd3fc" : "var(--panel-border)", color: "var(--fg-dim)", opacity: streaming || builders.length === 0 || verified.length < 1 ? 0.5 : 1 }}
              title="Switch to another green-ticked worker"
            >
              Switch worker… ▾
            </button>
            {switching && (
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute z-30 top-full left-0 mt-1 w-72 rounded-xl border shadow-xl"
                style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)" }}
              >
                <div className="px-3 py-2 text-[11px] uppercase tracking-wide border-b" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
                  Worker — chỉ hiện profile đã verify ✓
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {verified.map((b) => {
                    const isCurrent = b.id === builderId;
                    const isPending = b.id === pendingBuilder;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setPendingBuilder(b.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition"
                        style={{ background: isPending ? "rgba(125,211,252,0.14)" : "transparent", color: isPending ? "var(--fg)" : "var(--fg-dim)" }}
                        title={b.verifiedDetail ?? ""}
                      >
                        <span className="font-medium flex-1 truncate">{b.name}</span>
                        <span className="text-[10.5px] px-1 rounded border shrink-0" style={{ borderColor: "var(--panel-border)" }}>{b.cli}</span>
                        {b.effort && <span className="text-[10.5px] px-1 rounded border shrink-0" style={{ borderColor: "var(--panel-border)" }}>{b.effort}</span>}
                        {isCurrent && <span className="text-[10.5px] shrink-0" style={{ color: "#7dd3fc" }}>đang dùng</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--panel-border)" }}>
                  {(() => {
                    const cur = builders.find((b) => b.id === builderId)?.cli;
                    const nxt = builders.find((b) => b.id === pendingBuilder)?.cli;
                    const cliChange = Boolean(sessionId && cur && nxt && cur !== nxt);
                    const disabled = !pendingBuilder || pendingBuilder === builderId;
                    return (
                      <>
                        {cliChange && (
                          <span className="w-full text-[10.5px] pb-1" style={{ color: "var(--fg-dim)" }}>
                            Đổi CLI ({cur} → {nxt}): mặc định mở chat mới cho sạch. Chọn "Tiếp quản" khi worker hiện tại hết quota/lỗi — transcript sẽ được đóng gói gửi sang worker mới.
                          </span>
                        )}
                        <button
                          onClick={() => confirmSwitch("new")}
                          disabled={disabled}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border text-[12px]"
                          style={{ borderColor: "#7dd3fc", color: "#7dd3fc", opacity: disabled ? 0.4 : 1 }}
                        >
                          {cliChange ? "Chat mới" : "Confirm"}
                        </button>
                        {cliChange && (
                          <button
                            onClick={() => confirmSwitch("takeover")}
                            disabled={disabled}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border text-[12px]"
                            style={{ borderColor: "var(--panel-border)", color: "var(--fg)", opacity: disabled ? 0.4 : 1 }}
                            title="Worker mới nhận toàn bộ transcript đóng gói — dùng khi worker hiện tại hết quota hoặc chết login"
                          >
                            Tiếp quản
                          </button>
                        )}
                      </>
                    );
                  })()}
                  <button
                    onClick={() => setSwitching(false)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border text-[12px]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <span
            className="px-2 py-1 rounded-lg border text-[12px] max-w-[220px] truncate"
            style={{ borderColor: actualModel ? "rgba(125,211,252,0.5)" : "var(--panel-border)", color: actualModel ? "var(--fg)" : "var(--fg-dim)" }}
            title={actualModel
              ? `Model thật — CLI tự báo đang chạy model này. (Chọn: ${sessionModel ?? builders.find((b) => b.id === builderId)?.model ?? "CLI default"})`
              : "The model this session runs — session choice, else profile, else CLI default"}
          >
            {actualModel ?? sessionModel ?? builders.find((b) => b.id === builderId)?.model ?? "model: CLI default"}
          </span>
          <div className="relative shrink-0">
            <button
              onClick={() => { if (!switchingModel) void openModelSwitch(); else setSwitchingModel(false); setSwitching(false); }}
              disabled={streaming || !builderId}
              className="px-2.5 py-1 rounded-lg border text-[12px]"
              style={{ borderColor: switchingModel ? "#7dd3fc" : "var(--panel-border)", color: "var(--fg-dim)", opacity: streaming || !builderId ? 0.5 : 1 }}
              title="Switch model — reports usage right after"
            >
              Switch model… ▾
            </button>
            {switchingModel && (
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute z-30 top-full left-0 mt-1 w-80 rounded-xl border shadow-xl"
                style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)" }}
              >
                <div className="px-3 py-2 text-[11px] uppercase tracking-wide border-b" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
                  Model{modelList?.cliDefault ? ` — default: ${modelList.cliDefault}` : ""}
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {modelList === null && <p className="px-3 py-2 text-[12px]" style={{ color: "var(--fg-dim)" }}>reading the CLI's model list…</p>}
                  {modelList?.models.map((m) => {
                    const current = sessionModel ?? modelList.cliDefault;
                    const isPending = (customModel ? customModel : pendingModel) === m.id || (!customModel && !pendingModel && current === m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => { setPendingModel(m.id); setCustomModel(""); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition"
                        style={{ background: isPending ? "rgba(125,211,252,0.14)" : "transparent", color: isPending ? "var(--fg)" : "var(--fg-dim)" }}
                      >
                        <span className="font-medium flex-1 truncate">{m.id}</span>
                        {m.note && <span className="text-[10.5px] shrink-0">{m.note}</span>}
                        {current === m.id && <span className="text-[10.5px] shrink-0" style={{ color: "#7dd3fc" }}>đang dùng</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="px-3 py-2 border-t" style={{ borderColor: "var(--panel-border)" }}>
                  <input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="custom model…"
                    className="w-full px-2.5 py-1.5 rounded-lg border text-[12px] bg-transparent outline-none"
                    style={{ borderColor: customModel ? "#7dd3fc" : "var(--panel-border)" }}
                  />
                </div>
                <div className="flex gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--panel-border)" }}>
                  <button
                    onClick={() => void confirmModel()}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border text-[12px]"
                    style={{ borderColor: "#7dd3fc", color: "#7dd3fc" }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setSwitchingModel(false)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border text-[12px]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => void sendToKanban()}
            disabled={!sessionId || !turns?.some((turn) => turn.role === "user" && turn.text.trim()) || kanbanSaving}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] disabled:opacity-40"
            style={{ borderColor: "rgba(90,184,150,.5)", color: "#7ed0b1" }}
            title={sessionId ? "Create a linked backlog card from this session" : "Send a message first, then add the conversation to Kanban"}
          >
            {kanbanSaving ? <RefreshCw size={12} className="animate-spin" /> : <ListTodo size={12} />}
            → Kanban
          </button>
          {(() => {
            const cli = builders.find((b) => b.id === builderId)?.cli;
            const lane = cli === "kimi" ? "ACP" : cli === "claude" ? "duplex" : cli === "codex" ? "app-server" : "headless";
            return (
              <span
                className="px-1.5 py-1 rounded border text-[10.5px] shrink-0"
                style={{ borderColor: "var(--panel-border)", color: lane === "headless" ? "var(--fg-dim)" : "#7dd3fc" }}
                title={lane === "headless" ? "Worker này đi headless lane (cold mỗi lượt)" : `Worker này đi persistent lane (${lane}) — process ấm, stream token`}
              >
                {lane}
              </span>
            );
          })()}
          {(sidePanel || mode !== "closed") && !effectiveShowRight && (
            <button
              onClick={isOpen ? () => togglePanel() : toggleRight}
              className="-mr-2 p-1.5 rounded-md hover:bg-white/5 transition-colors shrink-0"
              style={{ color: "var(--fg-dim)" }}
              title="Toggle Right Panel"
            >
              <PanelRight size={16} />
            </button>
          )}

          {/* backdrop: click anywhere outside closes the open dropdown */}
          {(switching || switchingModel) && (
            <div
              className="fixed inset-0 z-20"
              onClick={() => { setSwitching(false); setSwitchingModel(false); }}
              onMouseDown={() => { setSwitching(false); setSwitchingModel(false); }}
            />
          )}
        </div>

        {/* Phase 12: execution-mode preference + the goal-linked plan. */}
        <div className="mx-4 mt-1 flex justify-end">
          <ExecutionModePicker />
        </div>
        {/* Phase 12: the goal-linked plan surfaces under the chat toolbar. */}
        {(() => {
          const goalId = sessions.find((session) => session.id === sessionId)?.goalId;
          return goalId ? <PlanningCard goalId={goalId} /> : null;
        })()}

        {staleWorker && (
          <div className="px-4 py-2 border-b text-[12px] flex items-center gap-2" style={{ borderColor: "var(--panel-border)", color: "#fbbf24" }}>
            <TriangleAlert size={13} className="shrink-0" />
            <span>
              Worker <code>{sessionBuilder}</code> của session này đã bị xóa — lượt tiếp theo sẽ dùng{" "}
              {builders.find((b) => b.id === builderId)?.name ?? "worker mặc định"}, hoặc bấm Switch worker… để chọn.
            </span>
          </div>
        )}
        {loginWall && (
          <div className="px-4 py-2 border-b text-[12px] flex items-center gap-2" style={{ borderColor: "var(--panel-border)", color: "#fbbf24" }}>
            <TriangleAlert size={13} className="shrink-0" />
            <span>This worker reported a login problem mid-conversation — Switch worker… to one that answers.</span>
          </div>
        )}
        {verified.length === 0 && builders.length > 0 && (
          <div className="px-4 py-2 border-b text-[12px] flex items-center gap-2" style={{ borderColor: "var(--panel-border)", color: "#fbbf24" }}>
            <TriangleAlert size={13} className="shrink-0" />
            <span>No green-ticked worker yet — run a profile's health probe in CLI Config so it earns its tick, then come back.</span>
          </div>
        )}

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {turns === null ? (
            <Empty>Loading…</Empty>
          ) : empty ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
              <SenMark size={40} style={{ opacity: 0.92 }} />
              <div>
                <div className="text-[15px] font-medium">Talk to Sen</div>
                <p className="text-[12.5px] mt-1 max-w-md" style={{ color: "var(--fg-dim)" }}>
                  The central agent orchestrator controlling NEWS OS. Sen coordinates a crew of coding agents —
                  every turn bills the worker above.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="px-3 py-1.5 rounded-full border text-[12px] text-left"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {notes.map((n, i) => (
                <div key={`n${i}`} className="text-center text-[11.5px]" style={{ color: "var(--fg-dim)" }}>{n}</div>
              ))}
            </div>
          ) : (
            <>
              {turns!.map((t, i) => {
                // Badge only when the answering worker CHANGES — a single-worker
                // conversation stays quiet.
                const prevAssistant = [...(turns ?? [])].slice(0, i).reverse().find((x) => x.role === "assistant");
                const showBadge = t.role === "assistant" && Boolean(t.builder) && t.builder !== prevAssistant?.builder;
                return t.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div
                      className="max-w-[75%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-[13px] whitespace-pre-wrap"
                      style={{ background: "rgba(125,211,252,0.16)", border: "1px solid rgba(125,211,252,0.35)" }}
                    >
                      {t.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2.5 group/msg">
                    <SenMark size={18} className="mt-1 shrink-0" style={{ opacity: 0.9 }} />
                    <div className="max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap">
                      {showBadge && (
                        <span className="block mb-0.5 text-[10.5px] uppercase tracking-wide" style={{ color: "var(--fg-dim)" }}>
                          {builders.find((b) => b.id === t.builder)?.name ?? t.builder}{t.model ? ` · ${t.model}` : ""}{t.effort ? ` · ${t.effort}` : ""}{t.usage?.input ? ` · ${fmtTokens(t.usage.input)} in · ${fmtTokens(t.usage.output ?? 0)} out` : ""}
                        </span>
                      )}
                      {t.text ? (
                        // Assistant answers render as markdown — the model writes
                        // **bold**, lists, tables, code fences; show them, not the markup.
                        <span className="fm-md block"><ReactMarkdown remarkPlugins={[remarkGfm]}>{t.text}</ReactMarkdown></span>
                      ) : (streaming && i === turns!.length - 1 ? (
                        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--fg-dim)" }}>
                          <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#7dd3fc" }} />
                          {activity ? "" : "đang nghĩ…"}
                        </span>
                      ) : t.text)}
                      {/* One rolling status line — latest thought or tool call,
                          gone the moment the answer lands. */}
                      {streaming && i === turns!.length - 1 && activity && (
                        <span className="block mt-1 text-[12px] italic truncate" style={{ color: "var(--fg-dim)" }}>
                          {activity}
                        </span>
                      )}
                      {t.text && (
                        <span className="flex items-center gap-2 mt-1">
                          <button
                            onClick={async (ev) => {
                              const btn = ev.currentTarget;
                              try { await navigator.clipboard.writeText(t.text); btn.textContent = "✓"; setTimeout(() => { btn.textContent = "copy"; }, 1200); } catch { /* blocked */ }
                            }}
                            className="text-[10.5px] px-1.5 py-0.5 rounded border opacity-0 group-hover/msg:opacity-100 transition"
                            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                            title="Copy this answer"
                          >
                            copy
                          </button>
                          {!streaming && i === turns!.length - 1 && lastTiming && (
                            <span className="text-[10.5px]" style={{ color: "var(--fg-dim)" }}>
                              {lastTiming.ttfb !== null ? `${(lastTiming.ttfb / 1000).toFixed(1)}s đầu tiên · ` : ""}{(lastTiming.ms / 1000).toFixed(1)}s
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {notes.map((n, i) => (
                <div key={`n${i}`} className="text-center text-[11.5px]" style={{ color: "var(--fg-dim)" }}>{n}</div>
              ))}
              {resetOffer && (
                <div className="flex items-center justify-center gap-2 text-[11.5px]" style={{ color: "var(--fg-dim)" }}>
                  <span>Quota hồi sớm nhất lúc {new Date(resetOffer.at).toLocaleTimeString("vi-VN")} ({resetOffer.worker}). Hẹn lịch tự probe lại?</span>
                  <button
                    onClick={async () => {
                      const r = await fetch("/api/sen/schedule-wake", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ at: resetOffer.at }),
                      }).catch(() => null);
                      const j = r ? await r.json().catch(() => ({})) : {};
                      setNotes((n) => [...n, r?.ok
                        ? `Đã hẹn wake lúc ${new Date(resetOffer.at).toLocaleTimeString("vi-VN")} — tới giờ server tự probe và báo kết quả ở đây.`
                        : `Không hẹn được: ${String(j.error ?? "lỗi mạng")}`]);
                      setResetOffer(null);
                    }}
                    className="px-2 py-0.5 rounded border text-[11px]"
                    style={{ borderColor: "#7dd3fc", color: "#7dd3fc" }}
                  >
                    Hẹn lịch
                  </button>
                  <button
                    onClick={() => setResetOffer(null)}
                    className="px-2 py-0.5 rounded border text-[11px]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                  >
                    Để sau
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* input */}
        <div className="px-4 pb-4">
          {images.length > 0 && (
            <div className="flex gap-2 mb-2">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="pasted" className="w-14 h-14 object-cover rounded-lg border" style={{ borderColor: "var(--panel-border)" }} />
                  <button
                    onClick={() => setImages((x) => x.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] grid place-items-center"
                    style={{ background: "var(--panel-border)", color: "var(--fg)" }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.25)" }}>
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                for (const f of files.slice(0, 3 - images.length)) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const url = String(reader.result ?? "");
                    const base64 = url.includes(",") ? url.split(",")[1] : url;
                    setImages((x) => [...x, { data: base64, mimeType: f.type, preview: url }].slice(0, 3));
                  };
                  reader.readAsDataURL(f);
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Message Sen…  (Enter to send, Shift+Enter for a newline, paste images)"
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              className="flex-1 bg-transparent outline-none resize-none text-[13px] py-1"
              autoFocus
            />
            {streaming ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                style={{ background: "rgba(248,113,113,0.2)", color: "#f87171", border: "1px solid rgba(248,113,113,0.45)" }}
                title="Stop this turn — the worker is killed, nothing keeps billing"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={(!draft.trim() && !images.length) || !builderId}
                className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                style={{
                  background: !draft.trim() || !builderId ? "rgba(125,211,252,0.15)" : "#7dd3fc",
                  color: !draft.trim() || !builderId ? "var(--fg-dim)" : "#0b1220",
                }}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {(sidePanel || isOpen) && effectiveShowRight && <div className="panel-resizer" onMouseDown={(e) => startResize("right", e)} title="Drag to resize info panel" />}
      {(sidePanel || isOpen) && effectiveShowRight && (
        <aside className="shrink-0 border-l overflow-y-auto" style={{ width: rightWidth, borderColor: "var(--panel-border)" }}>
          {isOpen ? <ContextAwareRightPanel /> : (typeof sidePanel === "function" ? sidePanel({ showRight, toggleRight, fallbackSelects }) : sidePanel)}
        </aside>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- view

export default function SenView() {
  const boot = parseAukerLocation();
  const [tab, setTab] = useState<FmTab>(boot.tab);
  const [deepLinkedSession, setDeepLinkedSession] = useState<string | null>(boot.session);
  const [initialPanelOpen] = useState(boot.openPanel);
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Deep-link: /sen?tab=code-space (legacy ?tab=fleet maps here too).
  useEffect(() => {
    const next = parseAukerLocation();
    setTab(next.tab);
    if (next.session) {
      setDeepLinkedSession(next.session);
      setTab("mission");
    }
  }, []);

  const load = useCallback(async (fresh = false) => {
    if (fresh) setRefreshing(true);
    try {
      const r = await fetch("/api/sen", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (j.error) { setErr(String(j.error)); return; }
      setErr(null);
      setData(j as Overview);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const senMenu = [
    { key: "mission",  label: "Dashboard", icon: <LayoutGrid size={14} /> },
    { key: "knowledge-base", label: "Knowledge Base", icon: <BookOpen size={14} /> },
    { key: "automations", label: "Automations", icon: <CalendarClock size={14} /> },
    { key: "loop", label: "Loop", icon: <Repeat size={14} /> },
    { key: "code-space", label: "Code Space", icon: <SquareTerminal size={14} /> },
    { key: "builders", label: "Builders", icon: <Wrench size={14} /> },
    { key: "memory",     label: "Memory",     icon: <Brain size={14} /> },
    { key: "integrations", label: "Integrations", icon: <Boxes size={14} /> },
    { key: "agent-kanban", label: "Agent Kanban", icon: <LayoutDashboard size={14} /> },
    { key: "activity-stream", label: "Activity Stream", icon: <Radio size={14} /> },
    { key: "reports",  label: "Reports & Plan",  icon: <FileText size={14} /> },
  ] as { key: FmTab; label: string; icon: React.ReactNode }[];
  const activeMenu = senMenu.find((item) => item.key === tab) ?? senMenu[0];

  const tabBar = (
    <div className="flex items-center gap-2">
      <span className="grid min-h-10 min-w-10 place-items-center rounded-lg border" style={{ borderColor: "var(--panel-border)", color: "#7dd3fc" }}>
        {activeMenu.icon}
      </span>
      <label className="sr-only" htmlFor="sen-panel-select">Sen panel</label>
      <select
        id="sen-panel-select"
        value={tab}
        onChange={(event) => setTab(event.target.value as FmTab)}
        className="min-h-10 flex-1 rounded-lg border bg-transparent px-3 text-[13px] outline-none"
        style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
      >
        {senMenu.map((item) => <option key={item.key} value={item.key} style={{ background: "#1e1e1e" }}>{item.label}</option>)}
      </select>
      <button
        onClick={() => void load(true)}
        className="grid min-h-10 min-w-10 place-items-center rounded-lg border shrink-0"
        style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
        title="Refresh Sen info"
      >
        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
      </button>
    </div>
  );

  const rightContent = (() => {
    if (tab === "mission") {
      return (
        <OverviewDashboard
          onOpenTab={(next) => {
            if (FM_TABS.includes(next as FmTab)) setTab(next as FmTab);
          }}
        />
      );
    }
    if (tab === "code-space") return <CodeSpaceView embedded />;
    if (tab === "builders") {
      return (
        <div className="flex min-h-[520px] flex-col overflow-y-auto">
          <BuildersView />
        </div>
      );
    }
    if (tab === "agent-kanban") {
      return (
        <div className="flex min-h-[520px] flex-col">
          <AgentKanban embedded />
        </div>
      );
    }
    if (tab === "activity-stream") {
      return (
        <div className="flex min-h-[460px] flex-col">
          <ActivityStream embedded />
        </div>
      );
    }
    if (tab === "memory") {
      return (
        <div className="flex min-h-[480px] flex-col">
          <MemoryPanel embedded />
        </div>
      );
    }
    if (tab === "integrations") {
      return (
        <div className="flex min-h-[480px] flex-col">
          <IntegrationsView embedded />
        </div>
      );
    }
    if (tab === "knowledge-base") {
      return (
        <div className="flex min-h-[480px] flex-col">
          <SenKnowledgeBase />
        </div>
      );
    }
    if (tab === "automations") {
      return (
        <div className="flex min-h-[480px] flex-col overflow-y-auto">
          <AutomationsView />
        </div>
      );
    }
    if (tab === "loop") {
      return (
        <div className="flex min-h-[480px] flex-col overflow-y-auto">
          <LoopView />
        </div>
      );
    }

    if (err) {
      return <div className="rounded-xl border p-4 text-[13px] flex items-center gap-2" style={{ borderColor: "var(--panel-border)", color: "#fca5a5" }}><TriangleAlert size={15} /> {err}</div>;
    }
    if (!data) return <Empty>Loading…</Empty>;

    if (tab === "reports") {
      return (
        <ReportsAndPlanContent
          reports={data.reports}
          plans={data.plans ?? []}
          planReports={data.planReports ?? []}
          plansRoots={data.plansRoots ?? []}
          homeFound={data.home.found}
        />
      );
    }

    return <Empty>Choose a panel tab.</Empty>;
  })();

  const rightPanel = ({ showRight, toggleRight, fallbackSelects }: { showRight: boolean, toggleRight: () => void, fallbackSelects: React.ReactNode }) => (
    <div className="sen-info-panel h-full flex flex-col">
      <div className="p-3 border-b space-y-2" style={{ borderColor: "var(--panel-border)" }}>
        <div className="flex items-center justify-between">
          <div className="text-[12px] uppercase tracking-[0.18em]" style={{ color: "var(--cream-mute)" }}>Sen panel</div>
          <button
            onClick={toggleRight}
            className="-mr-1 p-1.5 rounded-md hover:bg-white/5 transition-colors shrink-0"
            style={{ color: "var(--fg-dim)" }}
            title="Toggle Right Panel"
          >
            <PanelRight size={16} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[13px]" style={{ color: "var(--fg-dim)" }}>Choose content</div>
          {fallbackSelects}
        </div>
        {tabBar}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">{rightContent}</div>
    </div>
  );

  return (
    <ChatTab
      initialSessionId={deepLinkedSession}
      sidePanel={rightPanel}
      initialShowLeft
      initialShowRight={initialPanelOpen}
    />
  );
}
