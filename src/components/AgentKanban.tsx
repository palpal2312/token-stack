"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  GitBranch,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Cloud,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitPullRequest,
  Inbox,
  Layers3,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { apiStreamUrl } from "@/lib/apiFetch";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import PageHeaderIcon from "./PageHeaderIcon";
import { ActivityTimeline, formatWhen } from "./agent-kanban/ActivityTimeline";

type WorkflowStage =
  | "backlog"
  | "todo"
  | "doing"
  | "ready2review"
  | "reviewed"
  | "committed"
  | "merging"
  | "archived";

type RuntimeState =
  | "idle"
  | "queued"
  | "running"
  | "needs_input"
  | "blocked"
  | "quota_wait"
  | "failed"
  | "stopped";

type Role = "planner" | "builder" | "reviewer";
type AttemptStatus =
  | "created"
  | "queued"
  | "running"
  | "needs_input"
  | "succeeded"
  | "failed"
  | "stopped";

interface Attempt {
  id: string;
  builderId: string;
  role: Role;
  sessionId?: string;
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
  actualModel?: string;
  effort?: string;
  error?: string;
}

interface WorkItem {
  id: string;
  title: string;
  brief: string;
  workflowStage: WorkflowStage;
  runtimeState: RuntimeState;
  source: {
    kind: "manual" | "firstmate" | "planner" | "import";
    sessionId?: string;
  };
  attempts: Attempt[];
  activeAttemptId?: string;
  links: {
    projectPath?: string;
    worktreePath?: string;
    branch?: string;
    prUrl?: string;
    artifactId?: string;
  };
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string;
  doneAt?: string;
  note?: string;
  blockedReason?: string;
  recentActivity?: string;
}

interface BuilderRow {
  id: string;
  cli: string;
  name: string;
  model?: string | null;
  effort?: string | null;
  verifiedAt?: string;
  quota?: { text: string; checkedAt: string };
}

type RoleChoice =
  | { engine: "builder"; builderId?: string }
  | { engine: "ollama" | "hermes"; builderId?: string };

type RoleConfig = Record<Role, RoleChoice>;

interface KanbanEvent {
  seq?: number;
  id?: string;
  at?: string;
  type?: string;
  cardId?: string;
  attemptId?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  note?: string;
  card?: WorkItem;
  cards?: WorkItem[];
}

interface BuildRec {
  id: string;
  title: string;
  brief: string;
  goal: string;
  model: string;
  bytes: number;
  createdAt: number;
}

const STAGES: {
  key: WorkflowStage;
  label: string;
  short: string;
  accent: string;
  icon: typeof Inbox;
}[] = [
  { key: "backlog", label: "Backlog", short: "Backlog", accent: "#a59783", icon: Inbox },
  { key: "todo", label: "To do", short: "To do", accent: "#d4a574", icon: CircleDot },
  { key: "doing", label: "Doing", short: "Doing", accent: "#7dd3fc", icon: Zap },
  { key: "ready2review", label: "Ready to review", short: "Review", accent: "#c084fc", icon: ShieldCheck },
  { key: "reviewed", label: "Reviewed", short: "Reviewed", accent: "#5ab896", icon: Check },
  { key: "committed", label: "Committed", short: "Commit", accent: "#fbbf24", icon: FileCode2 },
  { key: "merging", label: "Merging", short: "Merge", accent: "#fb923c", icon: GitPullRequest },
  { key: "archived", label: "Archived", short: "Archive", accent: "#6e6353", icon: Archive },
];

const RUNTIME: Record<RuntimeState, { label: string; color: string }> = {
  idle: { label: "Idle", color: "#6e6353" },
  queued: { label: "Queued", color: "#d4a574" },
  running: { label: "Running", color: "#7dd3fc" },
  needs_input: { label: "Needs input", color: "#fbbf24" },
  blocked: { label: "Blocked", color: "#fb923c" },
  quota_wait: { label: "Quota wait", color: "#c084fc" },
  failed: { label: "Failed", color: "#f87171" },
  stopped: { label: "Stopped", color: "#94a3b8" },
};

// Must mirror the backend's authoritative edge set for the "user" actor
// (src/lib/agent-kanban/transitions.ts). Offering an edge the server rejects
// would surface a 409 on click; omitting a valid one hides a legal move.
const VALID_USER_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  backlog: ["todo"],
  todo: ["doing"],
  doing: ["ready2review", "todo"],
  ready2review: ["reviewed", "doing"],
  reviewed: ["committed"],
  committed: ["merging"],
  merging: ["archived"],
  archived: ["backlog"],
};

const DEFAULT_CONFIG: RoleConfig = {
  planner: { engine: "ollama" },
  builder: { engine: "ollama" },
  reviewer: { engine: "ollama" },
};

const SEO_SITE = {
  id: "aimoneylab",
  name: "aimoneylabjuliangoldie.com",
  url: "https://aimoneylabjuliangoldie.com",
};

const LEGACY_MIGRATION_MARKER = "agent-kanban-server-migration-v1";
const LEGACY_KEY_CANDIDATES = [
  "agent-kanban-cards",
  "agent-kanban",
  "agentKanbanCards",
  "kanban-cards",
];
const LEGACY_STAGES = new Set(["queued", "building", "reviewing", "done", "rejected"]);

function findLegacyCards(): { key: string; cards: unknown[] } | null {
  if (typeof window === "undefined") return null;
  let keys: string[] = [];
  try {
    keys = [
      ...LEGACY_KEY_CANDIDATES,
      ...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? "")
        .filter((key) => /agent.*kanban|kanban.*agent/i.test(key)),
    ];
  } catch { return null; }
  for (const key of [...new Set(keys)].filter(Boolean)) {
    let parsed: unknown;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      parsed = JSON.parse(raw);
    } catch { continue; }
    const cards = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown }).cards)
        ? (parsed as { cards: unknown[] }).cards
        : [];
    if (cards.some((item) => (
      item && typeof item === "object"
      && typeof (item as { title?: unknown }).title === "string"
      && LEGACY_STAGES.has(String((item as { stage?: unknown }).stage ?? ""))
    ))) return { key, cards };
  }
  return null;
}

function migrationIdFor(key: string): string {
  const safe = key.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `legacy-${safe || "browser"}-v1`.slice(0, 80);
}

function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({} as T));
}

function getCards(body: unknown): WorkItem[] {
  if (Array.isArray(body)) return body as WorkItem[];
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.cards)) return record.cards as WorkItem[];
  if (record.card && typeof record.card === "object") return [record.card as WorkItem];
  return [];
}

function getCard(body: unknown): WorkItem | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.card && typeof record.card === "object") return record.card as WorkItem;
  if (typeof record.id === "string" && typeof record.title === "string") return record as unknown as WorkItem;
  return null;
}

function ageLabel(value?: string): string {
  if (!value) return "";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function activeAttempt(card: WorkItem): Attempt | undefined {
  return card.attempts?.find((attempt) => attempt.id === card.activeAttemptId)
    ?? card.attempts?.[card.attempts.length - 1];
}

function eventCardId(event: KanbanEvent): string | undefined {
  return event.cardId
    ?? (typeof event.payload?.cardId === "string" ? event.payload.cardId : undefined)
    ?? event.card?.id;
}

function normalizeConfig(value: unknown): RoleConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG;
  const source = value as Record<string, unknown>;
  const root = source.config && typeof source.config === "object"
    ? source.config as Record<string, unknown>
    : source;
  const next = { ...DEFAULT_CONFIG };
  for (const role of ["planner", "builder", "reviewer"] as Role[]) {
    const row = root[role];
    if (!row || typeof row !== "object") continue;
    const choice = row as Record<string, unknown>;
    const engine = choice.engine;
    if (engine === "builder" || engine === "ollama" || engine === "hermes") {
      next[role] = {
        engine,
        ...(typeof choice.builderId === "string" && choice.builderId
          ? { builderId: choice.builderId }
          : {}),
      };
    }
  }
  return next;
}

function normalizeEvents(value: unknown): { events: KanbanEvent[]; cursor?: string } {
  if (Array.isArray(value)) return { events: value as KanbanEvent[] };
  if (!value || typeof value !== "object") return { events: [] };
  const record = value as Record<string, unknown>;
  const events = Array.isArray(record.events)
    ? record.events as KanbanEvent[]
    : Array.isArray(record.items)
      ? record.items as KanbanEvent[]
      : [];
  const cursorValue = record.nextCursor ?? record.cursor ?? record.lastSeq;
  return {
    events,
    ...(cursorValue !== undefined && cursorValue !== null
      ? { cursor: String(cursorValue) }
      : {}),
  };
}

export default function AgentKanban({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<"board" | "artifacts">("board");
  const [cards, setCards] = useState<WorkItem[]>([]);
  const cardsRef = useRef<WorkItem[]>([]);
  const [builders, setBuilders] = useState<BuilderRow[]>([]);
  const [config, setConfig] = useState<RoleConfig>(DEFAULT_CONFIG);
  const [selectedStage, setSelectedStage] = useState<WorkflowStage>("backlog");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<WorkItem | null>(null);
  const [detailEvents, setDetailEvents] = useState<KanbanEvent[]>([]);
  const [detailHasMore, setDetailHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseFailedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBrief, setNewBrief] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [query, setQuery] = useState("");
  const [dispatchBuilder, setDispatchBuilder] = useState("");
  const [ws, setWs] = useState<BuildRec[]>([]);
  const [seoGoal, setSeoGoal] = useState("");
  const [seoCards, setSeoCards] = useState<{ id: string; title: string; brief: string; status: string; note?: string; liveUrl?: string; slug?: string }[]>([]);
  const [seoBusy, setSeoBusy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (dispatchBuilder) return;
    if (config.builder.engine === "builder" && config.builder.builderId) {
      setDispatchBuilder(config.builder.builderId);
      return;
    }
    const firstVerified = builders.find((builder) => builder.verifiedAt);
    if (firstVerified) setDispatchBuilder(firstVerified.id);
  }, [builders, config.builder, dispatchBuilder]);

  const verifiedBuilders = useMemo(
    () => builders.filter((builder) => builder.verifiedAt),
    [builders],
  );

  const selected = useMemo(
    // Prefer the live board entity. SSE refreshes `cards` while the drawer is
    // open; an older detail snapshot must not hide a newly-created attempt.
    () => cards.find((card) => card.id === selectedId) ?? detailCard ?? null,
    [cards, detailCard, selectedId],
  );

  const attention = useMemo(
    () => cards.filter((card) => (
      ["needs_input", "failed", "quota_wait", "blocked"].includes(card.runtimeState)
      || (
        !["archived", "committed", "merging"].includes(card.workflowStage)
        && Date.now() - Date.parse(card.stageChangedAt) > 3 * 24 * 60 * 60_000
      )
    )),
    [cards],
  );

  // Board search filters the lanes by title/brief; the attention strip stays
  // unfiltered so blocked work never hides behind a query.
  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((card) =>
      card.title.toLowerCase().includes(q) || card.brief.toLowerCase().includes(q));
  }, [cards, query]);

  const upsertCard = useCallback((card: WorkItem) => {
    setCards((current) => {
      const found = current.some((item) => item.id === card.id);
      const next = found
        ? current.map((item) => item.id === card.id ? card : item)
        : [card, ...current];
      cardsRef.current = next;
      return next;
    });
    setDetailCard((current) => current?.id === card.id ? card : current);
  }, []);

  const removeCard = useCallback((cardId: string) => {
    setCards((current) => {
      const next = current.filter((item) => item.id !== cardId);
      cardsRef.current = next;
      return next;
    });
    setSelectedId((current) => (current === cardId ? null : current));
    setDetailCard((current) => (current?.id === cardId ? null : current));
  }, []);

  const loadCards = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/agent-kanban/cards", { cache: "no-store" });
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      const next = getCards(body);
      setCards(next);
      cardsRef.current = next;
      setErr(null);
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadBuildersAndConfig = useCallback(async () => {
    const [buildersResult, configResult] = await Promise.allSettled([
      fetch("/api/builders", { cache: "no-store" }).then(readJson<Record<string, unknown>>),
      fetch("/api/agent-kanban/config", { cache: "no-store" }).then(async (response) => {
        const body = await readJson<Record<string, unknown>>(response);
        if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
        return body;
      }),
    ]);
    if (buildersResult.status === "fulfilled") {
      setBuilders(Array.isArray(buildersResult.value.builders)
        ? buildersResult.value.builders as BuilderRow[]
        : []);
    }
    if (configResult.status === "fulfilled") setConfig(normalizeConfig(configResult.value));
  }, []);

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-kanban/workspace", { cache: "no-store" });
      const body = await readJson<{ builds?: BuildRec[] }>(response);
      setWs(Array.isArray(body.builds) ? body.builds : []);
    } catch {
      setWs([]);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const initializeBoard = async () => {
      let migrated = false;
      try {
        if (localStorage.getItem(LEGACY_MIGRATION_MARKER) !== "done") {
          const legacy = findLegacyCards();
          if (legacy) {
            const response = await fetch("/api/agent-kanban/cards", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                op: "migrate",
                migrationId: migrationIdFor(legacy.key),
                cards: legacy.cards,
              }),
            });
            if (response.ok) {
              localStorage.setItem(LEGACY_MIGRATION_MARKER, "done");
              migrated = true;
            }
          } else {
            localStorage.setItem(LEGACY_MIGRATION_MARKER, "done");
          }
        }
      } catch {
        // Keep the old localStorage data and try again on the next visit.
      }
      if (disposed) return;
      await Promise.all([
        loadCards(),
        loadBuildersAndConfig(),
        loadWorkspace(),
      ]);
      if (migrated && !disposed) setNotice("Imported the previous Agent Kanban board into the server workspace.");
    };
    void initializeBoard();
    return () => { disposed = true; };
  }, [loadBuildersAndConfig, loadCards, loadWorkspace]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const applyEvent = useCallback((event: KanbanEvent) => {
    if (typeof event.seq === "number") {
      if (event.seq <= lastSeqRef.current) return;
      lastSeqRef.current = event.seq;
    }
    if (event.card) {
      upsertCard(event.card);
      return;
    }
    if (Array.isArray(event.cards)) {
      setCards(event.cards);
      cardsRef.current = event.cards;
      return;
    }
    const cardId = eventCardId(event);
    if (!cardId) return;
    // A deletion removes the card locally; re-fetching a deleted id would 404
    // and silently leave a ghost card on the board.
    if (event.type === "card_deleted") {
      removeCard(cardId);
      return;
    }
    // Some backends inline the full card in the payload; use it directly.
    const payloadCard = getCard(event.payload);
    if (payloadCard) {
      upsertCard(payloadCard);
      return;
    }
    // The live event bus emits bare events with no card body, and the initial
    // replay can deliver hundreds at once. Coalesce into one board refresh
    // instead of one fetch per event; a 404 removes the vanished card.
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void fetch("/api/agent-kanban/cards", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = await readJson<Record<string, unknown>>(response);
          const next = getCards(body);
          setCards(next);
          cardsRef.current = next;
        })
        .catch(() => {});
    }, 250);
  }, [removeCard, upsertCard]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const since = lastSeqRef.current ? `?since=${lastSeqRef.current}` : "";
      try {
        source = new EventSource(apiStreamUrl(`/api/agent-kanban/events/stream${since}`));
      } catch {
        sseFailedRef.current = true;
        setSseConnected(false);
        return;
      }
      source.onopen = () => {
        sseFailedRef.current = false;
        setSseConnected(true);
      };
      source.onmessage = (message) => {
        try { applyEvent(JSON.parse(message.data) as KanbanEvent); } catch { /* heartbeat or prose */ }
      };
      source.addEventListener("event", (message) => {
        try { applyEvent(JSON.parse((message as MessageEvent).data) as KanbanEvent); } catch {}
      });
      source.onerror = () => {
        source?.close();
        source = null;
        sseFailedRef.current = true;
        setSseConnected(false);
        retry = setTimeout(connect, 4500);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
      source?.close();
    };
  }, [applyEvent]);

  usePollWhileVisible(
    () => { if (sseFailedRef.current) void loadCards(true); },
    12000,
    [],
  );

  const loadDetail = useCallback(async (cardId: string) => {
    setSelectedId(cardId);
    setDetailLoading(true);
    setDetailEvents([]);
    setDetailHasMore(false);
    try {
      const cardResponse = await fetch(
        `/api/agent-kanban/cards/${encodeURIComponent(cardId)}?limit=30`,
        { cache: "no-store" },
      );
      const cardBody = await readJson<Record<string, unknown>>(cardResponse);
      if (cardResponse.ok) {
        const card = getCard(cardBody);
        if (card) {
          setDetailCard(card);
          upsertCard(card);
        }
        const normalized = normalizeEvents(cardBody);
        setDetailEvents(normalized.events);
        setDetailHasMore(normalized.events.length >= 30);
      }
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setDetailLoading(false);
    }
  }, [upsertCard]);

  const loadOlderEvents = useCallback(async () => {
    if (!selectedId || !detailEvents.length || busy) return;
    setBusy("events");
    try {
      const oldestSeq = Math.min(
        ...detailEvents
          .map((event) => event.seq)
          .filter((seq): seq is number => typeof seq === "number"),
      );
      if (!Number.isFinite(oldestSeq) || oldestSeq <= 1) {
        setDetailHasMore(false);
        return;
      }
      const response = await fetch(
        `/api/agent-kanban/events?cardId=${encodeURIComponent(selectedId)}&before=${oldestSeq}&limit=30`,
        { cache: "no-store" },
      );
      const body = await readJson<unknown>(response);
      if (!response.ok) throw new Error(String((body as Record<string, unknown>)?.error ?? `HTTP ${response.status}`));
      const normalized = normalizeEvents(body);
      const older = normalized.events.filter((event) => typeof event.seq === "number" && event.seq < oldestSeq);
      setDetailEvents((current) => {
        const merged = [...current, ...older];
        const seen = new Set<string>();
        return merged.filter((event) => {
          const key = event.id ?? String(event.seq);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setDetailHasMore(older.length >= 30);
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, detailEvents, selectedId]);

  const createCard = useCallback(async () => {
    const title = newTitle.trim();
    const brief = newBrief.trim();
    if (!title || busy) return;
    setBusy("create");
    setErr(null);
    try {
      const response = await fetch("/api/agent-kanban/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          brief: brief || title,
          workflowStage: "backlog",
          source: { kind: "manual" },
        }),
      });
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      const card = getCard(body) ?? getCards(body)[0];
      if (card) upsertCard(card);
      else await loadCards(true);
      setNewTitle("");
      setNewBrief("");
      setShowComposer(false);
      setNotice("Card added to Backlog.");
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, loadCards, newBrief, newTitle, upsertCard]);

  const transition = useCallback(async (card: WorkItem, to: WorkflowStage) => {
    if (busy || to === card.workflowStage) return;
    setBusy(`transition:${card.id}`);
    setErr(null);
    try {
      const response = await fetch(
        `/api/agent-kanban/cards/${encodeURIComponent(card.id)}/transition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to, actor: "user" }),
        },
      );
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      const next = getCard(body);
      if (next) upsertCard(next);
      else await loadCards(true);
      setNotice(`Moved “${card.title}” to ${STAGES.find((stage) => stage.key === to)?.label ?? to}.`);
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, loadCards, upsertCard]);

  const dispatch = useCallback(async (card: WorkItem, builderId?: string) => {
    if (busy) return;
    setBusy(`dispatch:${card.id}`);
    setErr(null);
    try {
      const response = await fetch("/api/agent-kanban/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId: card.id,
          ...(builderId ? { builderId } : {}),
          mode: "lane",
        }),
      });
      if (!response.ok) {
        const body = await readJson<Record<string, unknown>>(response);
        throw new Error(String(body.error ?? `HTTP ${response.status}`));
      }
      if (!response.body) throw new Error("Dispatch opened without a response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.t === "attempt" && typeof event.sessionId === "string") {
              setNotice(`Attempt started · session ${event.sessionId}`);
            }
          } catch {}
        }
      }
      await loadCards(true);
      if (selectedId === card.id) await loadDetail(card.id);
      setNotice(`${card.attempts?.length ? "Retry started" : "Dispatched"} for “${card.title}”.`);
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, loadCards, loadDetail, selectedId]);

  const stopAttempt = useCallback(async (card: WorkItem) => {
    const attempt = activeAttempt(card);
    // A dispatch keeps its streaming request open for the whole worker turn.
    // Stopping that registered attempt must remain available during that
    // stream; only unrelated mutations block this action.
    if (!attempt || (busy && busy !== `dispatch:${card.id}`)) return;
    setBusy(`stop:${card.id}`);
    setErr(null);
    try {
      const response = await fetch("/api/agent-kanban/dispatch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id, attemptId: attempt.id }),
      });
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      await loadCards(true);
      if (selectedId === card.id) await loadDetail(card.id);
      setNotice(`Stop requested for “${card.title}”.`);
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, loadCards, loadDetail, selectedId]);

  const saveRole = useCallback(async (role: Role, value: string) => {
    if (busy) return;
    let choice: RoleChoice;
    if (value === "ollama" || value === "hermes") choice = { engine: value };
    else choice = { engine: "builder", builderId: value };
    const next = { ...config, [role]: choice };
    setConfig(next);
    setBusy(`config:${role}`);
    try {
      const response = await fetch("/api/agent-kanban/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      setConfig(normalizeConfig(body));
      setNotice(`${role[0].toUpperCase()}${role.slice(1)} engine saved.`);
    } catch (error) {
      setConfig(config);
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  }, [busy, config]);

  const deleteBuild = useCallback(async (id: string) => {
    if (!confirm("Delete this artifact? This cannot be undone.")) return;
    setWs((current) => current.filter((item) => item.id !== id));
    await fetch(`/api/agent-kanban/workspace?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const planSeo = useCallback(async () => {
    if (!seoGoal.trim() || seoBusy) return;
    setSeoBusy(true);
    setErr(null);
    setSeoCards([]);
    try {
      const response = await fetch("/api/agent-kanban/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: seoGoal.trim(), engine: "hermes" }),
      });
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      const planned = Array.isArray(body.cards) ? body.cards as { id: string; title: string; brief: string }[] : [];
      setSeoCards(planned.map((card) => ({ ...card, status: "queued" })));
    } catch (error) {
      setErr(String(error instanceof Error ? error.message : error));
    } finally {
      setSeoBusy(false);
    }
  }, [seoBusy, seoGoal]);

  const runSeo = useCallback(async () => {
    if (seoBusy) return;
    const queue = seoCards.filter((card) => card.status === "queued" || card.status === "failed");
    if (!queue.length) return;
    setSeoBusy(true);
    for (const card of queue) {
      setSeoCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "building", note: undefined } : item));
      try {
        const response = await fetch("/api/agent-kanban/build", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: card.id,
            title: card.title,
            brief: card.brief,
            goal: seoGoal,
            engine: "hermes",
            mode: "seo",
            siteId: SEO_SITE.id,
          }),
        });
        const body = await readJson<Record<string, unknown>>(response);
        const ok = response.ok && body.ok === true;
        setSeoCards((current) => current.map((item) => item.id === card.id ? {
          ...item,
          status: ok ? "done" : "failed",
          note: String(body.note ?? body.error ?? ""),
          ...(typeof body.liveUrl === "string" ? { liveUrl: body.liveUrl } : {}),
          ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
        } : item));
      } catch (error) {
        setSeoCards((current) => current.map((item) => item.id === card.id ? {
          ...item,
          status: "failed",
          note: String(error instanceof Error ? error.message : error),
        } : item));
      }
    }
    setSeoBusy(false);
    void loadWorkspace();
  }, [loadWorkspace, seoBusy, seoCards, seoGoal]);

  const deploySeo = useCallback(async () => {
    if (deploying) return;
    setDeploying(true);
    setDeployMsg("Building the site…");
    setDeployUrl(null);
    try {
      const response = await fetch("/api/seo/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: SEO_SITE.id }),
      });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === "step") setDeployMsg(`${String(event.label ?? "Deploying")}…`);
            if (event.type === "done") {
              setDeployMsg(event.ok ? "Published live ✓" : `Deploy failed: ${String(event.reason ?? "see logs")}`);
              if (typeof event.liveUrl === "string") setDeployUrl(event.liveUrl);
              else if (typeof event.netlifyUrl === "string") setDeployUrl(event.netlifyUrl);
            }
          } catch {}
        }
      }
    } catch (error) {
      setDeployMsg(`Deploy error: ${String(error instanceof Error ? error.message : error)}`);
    } finally {
      setDeploying(false);
    }
  }, [deploying]);

  const closeDetail = () => {
    setSelectedId(null);
    setDetailCard(null);
    setDetailEvents([]);
  };

  return (
    <div className={`flex min-h-0 flex-col h-full ${embedded ? "" : "px-4 md:px-6 py-3"}`}>
      <header className={`flex shrink-0 flex-wrap items-center gap-3 ${embedded ? "mb-2" : "mb-3"}`}>
        {!embedded && (
        <>
        <PageHeaderIcon gradient="linear-gradient(135deg,#7dd3fc,#5ab896)">
          <Layers3 size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Agent Kanban
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: sseConnected ? "rgba(90,184,150,.45)" : "var(--line-soft)",
                color: sseConnected ? "#5ab896" : "var(--cream-mute)",
                background: sseConnected ? "rgba(90,184,150,.10)" : "transparent",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: sseConnected ? "#5ab896" : "#6e6353" }} />
              {sseConnected ? "Live" : "Polling"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--cream-mute)]">
            Workflow stays deliberate; runtime attention stays visible without moving cards.
          </p>
        </div>
        </>
        )}

        {embedded && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: sseConnected ? "rgba(90,184,150,.45)" : "var(--line-soft)",
              color: sseConnected ? "#5ab896" : "var(--cream-mute)",
              background: sseConnected ? "rgba(90,184,150,.10)" : "transparent",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: sseConnected ? "#5ab896" : "#6e6353" }} />
            {sseConnected ? "Live" : "Polling"}
          </span>
        )}

        <div className={`flex items-center gap-1 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] p-1 ${embedded ? "" : "ml-auto"}`} style={embedded ? { marginLeft: "auto" } : undefined}>
          <button
            onClick={() => setTab("board")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition"
            style={tab === "board" ? { background: "#7dd3fc", color: "#07121c" } : { color: "var(--cream-mute)" }}
          >
            <Boxes size={13} /> Board
          </button>
          <button
            onClick={() => { setTab("artifacts"); void loadWorkspace(); }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition"
            style={tab === "artifacts" ? { background: "#d4a574", color: "#1a101f" } : { color: "var(--cream-mute)" }}
          >
            <FolderOpen size={13} /> Artifacts
            {ws.length > 0 && <span className="rounded-full bg-black/15 px-1 text-[10px]">{ws.length}</span>}
          </button>
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="mb-3 flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[12px]"
          style={{ borderColor: "rgba(90,184,150,.4)", background: "rgba(90,184,150,.09)", color: "#8ed9bd" }}
        >
          <Check size={13} /> {notice}
        </div>
      )}
      {err && (
        <div
          role="alert"
          className="mb-3 flex shrink-0 items-start gap-2 rounded-xl border px-3 py-2 text-[12px]"
          style={{ borderColor: "rgba(248,113,113,.4)", background: "rgba(248,113,113,.08)", color: "#fca5a5" }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{err}</span>
          <button onClick={() => setErr(null)} aria-label="Dismiss error"><X size={13} /></button>
        </div>
      )}

      {tab === "board" ? (
        <>
          <section
            aria-label="Role engines"
            className="mb-3 grid shrink-0 grid-cols-1 gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] p-2 sm:grid-cols-3"
          >
            {(["planner", "builder", "reviewer"] as Role[]).map((role) => {
              const current = config[role];
              const value = current.engine === "builder" ? current.builderId ?? "" : current.engine;
              return (
                <label key={role} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5">
                  <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--cream-mute)]">
                    {role}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <select
                      value={value}
                      onChange={(event) => void saveRole(role, event.target.value)}
                      disabled={busy === `config:${role}`}
                      className="min-h-9 w-full appearance-none rounded-lg border border-[var(--line-soft)] bg-[var(--bg-card)] px-2.5 pr-8 text-[12px] text-[var(--cream)] outline-none focus:border-[#7dd3fc]"
                      aria-label={`${role} engine`}
                    >
                      <option value="ollama">Local Ollama</option>
                      <option value="hermes">Hermes</option>
                      {verifiedBuilders.map((builder) => (
                        <option key={builder.id} value={builder.id}>
                          {builder.name} · {builder.cli}
                        </option>
                      ))}
                    </select>
                    {busy === `config:${role}`
                      ? <Loader2 size={13} className="absolute right-2.5 top-2.5 animate-spin text-[#7dd3fc]" />
                      : <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-2.5 text-[var(--cream-mute)]" />}
                  </span>
                </label>
              );
            })}
          </section>

          <section className="mb-3 shrink-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--cream-mute)]">Attention</span>
                <span
                  className="rounded-full border px-1.5 py-0.5 text-[10px]"
                  style={{
                    borderColor: attention.length ? "rgba(251,191,36,.42)" : "var(--line-soft)",
                    color: attention.length ? "#fbbf24" : "var(--cream-mute)",
                  }}
                >
                  {attention.length}
                </span>
              </div>
              <div className="relative ml-auto">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--cream-mute)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search cards…"
                  aria-label="Search cards"
                  className="min-h-9 w-44 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-card)] pl-7 pr-2 text-[11px] text-[var(--cream-soft)] outline-none focus:border-[#7dd3fc]"
                />
              </div>
              <button
                onClick={() => void loadCards(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--line-soft)] px-2.5 text-[11px] text-[var(--cream-mute)] hover:text-[var(--cream)]"
              >
                <RefreshCw size={12} /> Refresh
              </button>
              <button
                onClick={() => setShowComposer((value) => !value)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold"
                style={{ background: "#7dd3fc", color: "#06131d" }}
              >
                <Send size={12} /> New card
              </button>
            </div>

            {showComposer && (
              <div className="mb-2 grid gap-2 rounded-xl border border-[rgba(125,211,252,.28)] bg-[rgba(125,211,252,.05)] p-3 md:grid-cols-[minmax(180px,.8fr)_minmax(260px,1.7fr)_auto]">
                <input
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Card title"
                  maxLength={120}
                  className="min-h-11 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-card)] px-3 text-[13px] outline-none focus:border-[#7dd3fc]"
                  autoFocus
                />
                <input
                  value={newBrief}
                  onChange={(event) => setNewBrief(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void createCard(); }}
                  placeholder="A deterministic brief: desired outcome, constraints, acceptance signal"
                  maxLength={1200}
                  className="min-h-11 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-card)] px-3 text-[13px] outline-none focus:border-[#7dd3fc]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void createCard()}
                    disabled={!newTitle.trim() || busy === "create"}
                    className="min-h-11 flex-1 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: "#5ab896", color: "#07140e" }}
                  >
                    {busy === "create" ? "Adding…" : "Add to backlog"}
                  </button>
                  <button
                    onClick={() => setShowComposer(false)}
                    aria-label="Cancel new card"
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            <div
              aria-label="Attention cards"
              className="flex gap-2 overflow-x-auto rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] p-2"
            >
              {attention.length === 0 ? (
                <div className="flex min-h-16 w-full items-center gap-2 rounded-lg border border-dashed border-[var(--line-soft)] px-3 text-[11px] text-[var(--cream-mute)]">
                  <Check size={13} style={{ color: "#5ab896" }} />
                  No blocked, quota-waiting, failed, or stale work right now.
                </div>
              ) : attention.map((card) => {
                const runtime = RUNTIME[card.runtimeState];
                const stale = !["needs_input", "failed", "quota_wait", "blocked"].includes(card.runtimeState);
                return (
                  <button
                    key={card.id}
                    onClick={() => void loadDetail(card.id)}
                    className="min-h-16 min-w-[240px] max-w-[320px] shrink-0 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-2.5 text-left transition hover:-translate-y-0.5"
                    style={{ borderColor: `${runtime.color}55` }}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: runtime.color }}>
                      {stale ? <Clock3 size={11} /> : <AlertTriangle size={11} />}
                      {stale ? `Aging · ${ageLabel(card.stageChangedAt)}` : runtime.label}
                    </div>
                    <div className="mt-1 truncate text-[12px] font-medium text-[var(--cream)]">{card.title}</div>
                    <div className="mt-0.5 line-clamp-1 text-[10.5px] text-[var(--cream-mute)]">
                      {card.blockedReason ?? card.note ?? card.recentActivity ?? card.brief}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mb-2 flex shrink-0 gap-1 overflow-x-auto lg:hidden" aria-label="Board lane selector">
            {STAGES.map((stage) => (
              <button
                key={stage.key}
                onClick={() => setSelectedStage(stage.key)}
                className="min-h-10 shrink-0 rounded-lg border px-3 text-[11px]"
                style={{
                  borderColor: selectedStage === stage.key ? stage.accent : "var(--line-soft)",
                  color: selectedStage === stage.key ? stage.accent : "var(--cream-mute)",
                  background: selectedStage === stage.key ? `${stage.accent}14` : "transparent",
                }}
              >
                {stage.short} · {visibleCards.filter((card) => card.workflowStage === stage.key).length}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-x-auto pb-2">
            <div className="flex h-full min-w-max gap-3">
              {STAGES.map((stage) => {
                const laneCards = visibleCards.filter((card) => card.workflowStage === stage.key);
                const Icon = stage.icon;
                return (
                  <section
                    key={stage.key}
                    aria-label={`${stage.label} lane`}
                    className={`${selectedStage === stage.key ? "flex" : "hidden"} panel min-h-[360px] w-[292px] shrink-0 flex-col overflow-hidden p-0 lg:flex`}
                  >
                    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
                      <Icon size={13} style={{ color: stage.accent }} />
                      <h2 className="text-[11px] font-semibold uppercase tracking-[.14em]" style={{ color: stage.accent }}>
                        {stage.label}
                      </h2>
                      <span className="ml-auto text-[10px] text-[var(--cream-mute)]">{laneCards.length}</span>
                    </div>
                    <div className="scroll flex-1 space-y-2 overflow-y-auto p-2">
                      {loading && stage.key === "backlog" && (
                        <div className="flex items-center gap-2 p-3 text-[11px] text-[var(--cream-mute)]">
                          <Loader2 size={12} className="animate-spin" /> Loading board…
                        </div>
                      )}
                      {!loading && laneCards.length === 0 && (
                        <div className="rounded-lg border border-dashed border-[var(--line-soft)] p-3 text-center text-[10.5px] text-[var(--cream-mute)]">
                          {query.trim() ? "No matches in this lane." : `No cards in ${stage.label.toLowerCase()}.`}
                        </div>
                      )}
                      {laneCards.map((card) => (
                        <KanbanCard
                          key={card.id}
                          card={card}
                          builders={builders}
                          onOpen={() => void loadDetail(card.id)}
                          onTransition={(to) => void transition(card, to)}
                          busy={busy === `transition:${card.id}`}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="scroll flex-1 min-h-0 overflow-y-auto">
          <section className="mb-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--cream)]">
                  <Cloud size={14} style={{ color: "#d9b27d" }} /> SEO artifact workflow
                </div>
                <p className="mt-0.5 text-[10.5px] text-[var(--cream-mute)]">
                  Hermes plans and writes articles; this remains separate from workflow cards.
                </p>
              </div>
              <a
                href={SEO_SITE.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-[#d9b27d]"
              >
                {SEO_SITE.name} <ExternalLink size={10} />
              </a>
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                value={seoGoal}
                onChange={(event) => setSeoGoal(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void planSeo(); }}
                placeholder="Plan an SEO cluster…"
                className="min-h-11 flex-1 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-card)] px-3 text-[13px] outline-none focus:border-[#d9b27d]"
              />
              <button
                onClick={() => void planSeo()}
                disabled={!seoGoal.trim() || seoBusy}
                className="min-h-11 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: "#d9b27d", color: "#1a101f" }}
              >
                {seoBusy && seoCards.length === 0 ? "Planning…" : "Plan articles"}
              </button>
              {seoCards.some((card) => card.status === "queued" || card.status === "failed") && (
                <button
                  onClick={() => void runSeo()}
                  disabled={seoBusy}
                  className="min-h-11 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: "#5ab896", color: "#07140e" }}
                >
                  {seoBusy ? "Writing…" : "Run writers"}
                </button>
              )}
              {seoCards.some((card) => card.status === "done") && (
                <button
                  onClick={() => void deploySeo()}
                  disabled={deploying}
                  className="min-h-11 rounded-lg border px-4 text-[12px] font-semibold disabled:opacity-40"
                  style={{ borderColor: "#d9b27d", color: "#d9b27d" }}
                >
                  {deploying ? "Publishing…" : "Publish site"}
                </button>
              )}
            </div>
            {deployMsg && (
              <div className="mt-2 text-[11px] text-[var(--cream-mute)]">
                {deployMsg}{" "}
                {deployUrl && <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-[#d9b27d] underline">open live site</a>}
              </div>
            )}
            {seoCards.length > 0 && (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {seoCards.map((card) => (
                  <div key={card.id} className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{
                        background: card.status === "done" ? "#5ab896" : card.status === "failed" ? "#f87171" : card.status === "building" ? "#d9b27d" : "#6e6353",
                      }} />
                      <span className="truncate text-[12px] font-medium">{card.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10.5px] text-[var(--cream-mute)]">{card.brief}</p>
                    {card.note && <p className="mt-2 text-[10px] text-[var(--cream-mute)]">{card.note}</p>}
                    {card.liveUrl && (
                      <a href={card.liveUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#d9b27d]">
                        /blog/{card.slug}/ <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mb-3 flex items-center gap-2">
            <div>
              <h2 className="text-[14px] font-medium text-[var(--cream)]">Saved artifacts</h2>
              <p className="text-[10.5px] text-[var(--cream-mute)]">HTML previews and SEO builds saved on this machine.</p>
            </div>
            <button onClick={() => void loadWorkspace()} className="ml-auto grid min-h-10 min-w-10 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)]" aria-label="Refresh artifacts">
              <RefreshCw size={13} />
            </button>
          </div>
          {ws.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--line-soft)] text-center text-[12px] text-[var(--cream-mute)]">
              <div><FolderOpen size={28} className="mx-auto mb-2 opacity-50" />No saved artifacts yet.</div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ws.map((build) => (
                <article key={build.id} className="overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)]">
                  <iframe
                    src={`/api/agent-kanban/preview/${encodeURIComponent(build.id)}`}
                    title={build.title}
                    loading="lazy"
                    sandbox="allow-scripts allow-popups"
                    className="w-full border-0 bg-black"
                    style={{ aspectRatio: "16/10" }}
                  />
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[12px] font-medium">{build.title}</h3>
                        <p className="mt-1 line-clamp-2 text-[10.5px] text-[var(--cream-mute)]">{build.brief}</p>
                      </div>
                      <button
                        onClick={() => void deleteBuild(build.id)}
                        aria-label={`Delete ${build.title}`}
                        className="grid min-h-9 min-w-9 place-items-center rounded-lg text-[var(--cream-mute)] hover:text-[#f87171]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[9.5px] text-[var(--cream-mute)]">
                      <span>{(build.bytes / 1024).toFixed(1)} KB</span>
                      <span>·</span>
                      <span className="truncate">{build.model}</span>
                      <button
                        onClick={() => window.open(`/api/agent-kanban/preview/${encodeURIComponent(build.id)}`, "_blank", "noopener,noreferrer")}
                        className="ml-auto inline-flex items-center gap-1 text-[var(--gold)]"
                      >
                        open <ExternalLink size={9} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <DetailDrawer
          card={selected}
          builders={builders}
          events={detailEvents}
          loading={detailLoading}
          hasMore={detailHasMore}
          busy={busy}
          dispatchBuilder={dispatchBuilder}
          onDispatchBuilder={setDispatchBuilder}
          onClose={closeDetail}
          onTransition={(to) => void transition(selected, to)}
          onDispatch={() => void dispatch(selected, dispatchBuilder || undefined)}
          onStop={() => void stopAttempt(selected)}
          onLoadMore={() => void loadOlderEvents()}
        />
      )}
    </div>
  );
}

function KanbanCard({
  card,
  builders,
  onOpen,
  onTransition,
  busy,
}: {
  card: WorkItem;
  builders: BuilderRow[];
  onOpen: () => void;
  onTransition: (to: WorkflowStage) => void;
  busy: boolean;
}) {
  const attempt = activeAttempt(card);
  const runtime = RUNTIME[card.runtimeState];
  const stageIndex = STAGES.findIndex((stage) => stage.key === card.workflowStage);
  const previous = VALID_USER_TRANSITIONS[card.workflowStage].find((stage) => STAGES.findIndex((item) => item.key === stage) < stageIndex);
  const next = VALID_USER_TRANSITIONS[card.workflowStage].find((stage) => STAGES.findIndex((item) => item.key === stage) > stageIndex);
  const builder = attempt ? builders.find((row) => row.id === attempt.builderId) : undefined;
  const chatSession = attempt?.sessionId ?? card.source.sessionId;

  return (
    <article
      className="group rounded-xl border bg-[var(--bg-card)] p-2.5 transition hover:-translate-y-0.5 hover:border-[var(--line)]"
      style={{ borderColor: ["failed", "needs_input", "quota_wait", "blocked"].includes(card.runtimeState) ? `${runtime.color}55` : "var(--line-soft)" }}
    >
      <button onClick={onOpen} className="block w-full text-left">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: runtime.color, boxShadow: card.runtimeState === "running" ? `0 0 9px ${runtime.color}` : "none" }} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-medium leading-snug text-[var(--cream)]">{card.title}</h3>
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-[var(--cream-mute)]">{card.brief}</p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <span className="rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[9.5px]" style={{ color: runtime.color }}>
            {runtime.label}
          </span>
          {attempt && (
            <span className="max-w-full truncate rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[9.5px] text-[var(--cream-mute)]">
              {attempt.role} · {builder?.name ?? attempt.builderId}
            </span>
          )}
          {attempt?.actualModel && (
            <span className="max-w-full truncate rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[9.5px] text-[var(--cream-mute)]">
              {attempt.actualModel}{attempt.effort ? ` · ${attempt.effort}` : ""}
            </span>
          )}
        </div>
        {(card.blockedReason || attempt?.error || card.note) && (
          <p className="mt-2 line-clamp-2 rounded-lg px-2 py-1.5 text-[10px]" style={{ background: `${runtime.color}0d`, color: runtime.color }}>
            {card.blockedReason ?? attempt?.error ?? card.note}
          </p>
        )}
      </button>

      <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--line-deep)] pt-2">
        <span className="text-[9.5px] text-[var(--cream-mute)]">{card.attempts?.length ?? 0} attempt{card.attempts?.length === 1 ? "" : "s"}</span>
        <span className="text-[9.5px] text-[var(--cream-mute)]">· {ageLabel(card.updatedAt) || "now"}</span>
        {chatSession && (
          <Link
            href={`/sen?session=${encodeURIComponent(chatSession)}`}
            onClick={(event) => event.stopPropagation()}
            className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[9.5px] text-[#7dd3fc]"
          >
            <MessageSquare size={10} /> Chat
          </Link>
        )}
      </div>
      <div className="mt-1 flex gap-1">
        {previous && (
          <button
            onClick={() => onTransition(previous)}
            disabled={busy}
            className="grid min-h-9 min-w-9 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] disabled:opacity-40"
            aria-label={`Move ${card.title} to ${previous}`}
          >
            <ArrowLeft size={12} />
          </button>
        )}
        <button
          onClick={onOpen}
          className="min-h-9 flex-1 rounded-lg border border-[var(--line-soft)] text-[10.5px] text-[var(--cream-mute)]"
        >
          Details
        </button>
        {next && (
          <button
            onClick={() => onTransition(next)}
            disabled={busy}
            className="grid min-h-9 min-w-9 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)] disabled:opacity-40"
            aria-label={`Move ${card.title} to ${next}`}
          >
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </article>
  );
}

function DetailDrawer({
  card,
  builders,
  events,
  loading,
  hasMore,
  busy,
  dispatchBuilder,
  onDispatchBuilder,
  onClose,
  onTransition,
  onDispatch,
  onStop,
  onLoadMore,
}: {
  card: WorkItem;
  builders: BuilderRow[];
  events: KanbanEvent[];
  loading: boolean;
  hasMore: boolean;
  busy: string | null;
  dispatchBuilder: string;
  onDispatchBuilder: (value: string) => void;
  onClose: () => void;
  onTransition: (to: WorkflowStage) => void;
  onDispatch: () => void;
  onStop: () => void;
  onLoadMore: () => void;
}) {
  const attempt = activeAttempt(card);
  const runtime = RUNTIME[card.runtimeState];
  const sessions = [...new Set([
    card.source.sessionId,
    ...card.attempts.map((item) => item.sessionId),
  ].filter(Boolean) as string[])];
  const links = card.links ?? {};
  const validTransitions = VALID_USER_TRANSITIONS[card.workflowStage];
  const dispatching = busy === `dispatch:${card.id}`;
  const stopping = busy === `stop:${card.id}`;
  const transitioning = busy === `transition:${card.id}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanban-detail-title"
        className="scroll h-full w-full max-w-[680px] overflow-y-auto border-l border-[var(--line)] bg-[var(--bg-mid)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-[var(--line-soft)] bg-[rgba(28,22,34,.94)] px-4 py-3 backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: runtime.color, boxShadow: card.runtimeState === "running" ? `0 0 10px ${runtime.color}` : "none" }} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="kanban-detail-title" className="text-[17px] font-medium leading-tight">{card.title}</h2>
                <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: `${runtime.color}66`, color: runtime.color }}>
                  {runtime.label}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--cream-mute)]">
                {STAGES.find((stage) => stage.key === card.workflowStage)?.label} · updated {formatWhen(card.updatedAt)}
              </p>
            </div>
            <button onClick={onClose} className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-[var(--line-soft)] text-[var(--cream-mute)]" aria-label="Close card details">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--cream-mute)]">Brief</h3>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--cream-soft)]">{card.brief}</p>
            {(card.blockedReason || attempt?.error || card.note || card.recentActivity) && (
              <div className="mt-3 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: `${runtime.color}44`, background: `${runtime.color}0a`, color: runtime.color }}>
                {card.blockedReason ?? attempt?.error ?? card.note ?? card.recentActivity}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Play size={13} style={{ color: "#7dd3fc" }} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--cream-mute)]">Actions</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="relative">
                <span className="sr-only">Builder for dispatch</span>
                <select
                  value={dispatchBuilder}
                  onChange={(event) => onDispatchBuilder(event.target.value)}
                  className="min-h-11 w-full appearance-none rounded-lg border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 pr-9 text-[12px] outline-none focus:border-[#7dd3fc]"
                >
                  <option value="">Configured builder</option>
                  {builders.filter((builder) => builder.verifiedAt).map((builder) => (
                    <option key={builder.id} value={builder.id}>{builder.name} · {builder.cli}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 text-[var(--cream-mute)]" />
              </label>
              <button
                onClick={onDispatch}
                disabled={dispatching || card.workflowStage === "archived"}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: card.attempts.length ? "#d4a574" : "#5ab896", color: "#0c1410" }}
              >
                {dispatching ? <Loader2 size={13} className="animate-spin" /> : card.attempts.length ? <RotateCcw size={13} /> : <Play size={13} />}
                {card.attempts.length ? "Retry / switch" : "Dispatch lane"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {validTransitions.map((to) => (
                <button
                  key={to}
                  onClick={() => onTransition(to)}
                  disabled={transitioning}
                  className="min-h-10 rounded-lg border px-3 text-[11px] disabled:opacity-40"
                  style={{
                    borderColor: STAGES.find((stage) => stage.key === to)?.accent ?? "var(--line-soft)",
                    color: STAGES.find((stage) => stage.key === to)?.accent ?? "var(--cream)",
                  }}
                >
                  Move to {STAGES.find((stage) => stage.key === to)?.label ?? to}
                </button>
              ))}
              {attempt && ["queued", "running", "needs_input"].includes(attempt.status) && (
                <button
                  onClick={onStop}
                  disabled={stopping}
                  className="min-h-10 rounded-lg border px-3 text-[11px] disabled:opacity-40"
                  style={{ borderColor: "rgba(248,113,113,.45)", color: "#fca5a5" }}
                >
                  {stopping ? "Stopping…" : "Stop active attempt"}
                </button>
              )}
            </div>
          </section>

          {(sessions.length > 0 || Object.values(links).some(Boolean)) && (
            <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-4">
              <div className="mb-3 flex items-center gap-2">
                <GitBranch size={13} style={{ color: "#d4a574" }} />
                <h3 className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--cream-mute)]">Links & context</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {sessions.map((session, index) => (
                  <Link key={session} href={`/sen?session=${encodeURIComponent(session)}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[rgba(125,211,252,.35)] px-3 text-[11px] text-[#7dd3fc]">
                    <MessageSquare size={12} /> {index === 0 ? "Open chat" : `Attempt chat ${index + 1}`}
                  </Link>
                ))}
                {links.artifactId && (
                  <a href={`/api/agent-kanban/preview/${encodeURIComponent(links.artifactId)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--line-soft)] px-3 text-[11px] text-[var(--gold)]">
                    <FileCode2 size={12} /> Artifact <ExternalLink size={10} />
                  </a>
                )}
                {links.prUrl && (
                  <a href={links.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--line-soft)] px-3 text-[11px] text-[#c084fc]">
                    <GitPullRequest size={12} /> Pull request <ExternalLink size={10} />
                  </a>
                )}
                {links.branch && <span className="inline-flex min-h-10 items-center rounded-lg border border-[var(--line-soft)] px-3 text-[11px] text-[var(--cream-mute)]">branch · {links.branch}</span>}
                {links.projectPath && <span title={links.projectPath} className="inline-flex min-h-10 max-w-full items-center truncate rounded-lg border border-[var(--line-soft)] px-3 text-[11px] text-[var(--cream-mute)]">project · {links.projectPath}</span>}
                {links.worktreePath && <span title={links.worktreePath} className="inline-flex min-h-10 max-w-full items-center truncate rounded-lg border border-[var(--line-soft)] px-3 text-[11px] text-[var(--cream-mute)]">worktree · {links.worktreePath}</span>}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bot size={13} style={{ color: "#5ab896" }} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--cream-mute)]">
                Attempts · {card.attempts.length}
              </h3>
            </div>
            {card.attempts.length === 0 ? (
              <p className="text-[11px] text-[var(--cream-mute)]">Not dispatched yet.</p>
            ) : (
              <div className="space-y-2">
                {[...card.attempts].reverse().map((item) => {
                  const builder = builders.find((row) => row.id === item.builderId);
                  const active = item.id === card.activeAttemptId;
                  return (
                    <div key={item.id} className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-mid)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: item.status === "failed" ? "#f87171" : item.status === "running" ? "#7dd3fc" : item.status === "succeeded" ? "#5ab896" : "#6e6353" }} />
                        <span className="text-[12px] font-medium">{builder?.name ?? item.builderId}</span>
                        <span className="rounded border border-[var(--line-soft)] px-1.5 py-0.5 text-[9.5px] text-[var(--cream-mute)]">{item.role}</span>
                        <span className="text-[10px] text-[var(--cream-mute)]">{item.status.replace("_", " ")}</span>
                        {active && <span className="ml-auto text-[9.5px] text-[#7dd3fc]">active</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--cream-mute)]">
                        {item.actualModel && <span>{item.actualModel}{item.effort ? ` · ${item.effort}` : ""}</span>}
                        {item.startedAt && <span>started {formatWhen(item.startedAt)}</span>}
                        {item.endedAt && <span>ended {formatWhen(item.endedAt)}</span>}
                      </div>
                      {item.error && <p className="mt-2 text-[10.5px] text-[#fca5a5]">{item.error}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <ActivityTimeline
            events={events}
            loading={loading}
            hasMore={hasMore}
            busy={busy}
            onLoadMore={onLoadMore}
          />

          <section className="grid grid-cols-2 gap-2 text-[10px] text-[var(--cream-mute)] sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--line-soft)] p-2"><span className="block uppercase tracking-wide">Created</span><span className="mt-1 block text-[var(--cream-soft)]">{formatWhen(card.createdAt)}</span></div>
            <div className="rounded-lg border border-[var(--line-soft)] p-2"><span className="block uppercase tracking-wide">Stage changed</span><span className="mt-1 block text-[var(--cream-soft)]">{formatWhen(card.stageChangedAt)}</span></div>
            <div className="rounded-lg border border-[var(--line-soft)] p-2"><span className="block uppercase tracking-wide">Source</span><span className="mt-1 block text-[var(--cream-soft)]">{card.source.kind}</span></div>
            <div className="rounded-lg border border-[var(--line-soft)] p-2"><span className="block uppercase tracking-wide">Done</span><span className="mt-1 block text-[var(--cream-soft)]">{formatWhen(card.doneAt)}</span></div>
          </section>
        </div>
      </aside>
    </div>
  );
}
