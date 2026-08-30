"use client";

// Phase 19a U0/U4 — deterministic production-sized long-list fixture (test-only).
//
// Renders QA_FIXTURE_ROWS logical rows through a windowed viewport so DOM stays
// bounded even though the dataset is 10,000 rows. Three kinds are exercised:
//   - "conversation": a 10k-message SEN/thread-sized transcript (fixed-height)
//   - "kanban": a 10k-row runtime/Kanban list (fixed-height)
//   - "activity": a 10k-row MEMORY/ACTIVITY/analytics-style timeline with
//     VARIABLE-height rows (timestamp + actor + event text + status).
//
// This is the fixture the production budget's "bounded fixture DOM" invariant
// is measured against. The routes that mount it gate on
// AGENTIC_OS_ALLOW_TEST_FIXTURE=1 (set by qa/playwright.config.ts) and 404
// otherwise; the fixture never appears in canonical product navigation and has
// no realwork/message/runtime/memory authority of its own — pure presentation.
//
// U4: the windowing renderer is now the REUSABLE production `VirtualList`
// (src/components/virtual/VirtualList.tsx) — the same component intended for the
// production conversation/activity/kanban/runtime/search lists. It layers the
// medium-list `content-visibility: auto` fallback on the hard bound from
// virtualizing the window (only ~ (viewport/rowH + 2*overscan) rows are ever
// mounted). Matching the U0 contract, LongListFixture preserves the same
// testids/DOM shape the frozen long-list budget measures, and adds interactivity
// the U4 browser spec drives: single-select (click) with selection preserved
// across scroll, pull-based scroll-anchor restore, and listbox keyboard nav
// (Home/End/PageUp/PageDown/Arrow*).

import { useMemo, useState } from "react";
import { VirtualList, windowForScroll } from "@/components/virtual/VirtualList";

export const QA_FIXTURE_ROWS = 10_000;

const ROW_H = 44;
const OVERSCAN = 12;
const VIEWPORT_H = 560;

export type FixtureKind = "conversation" | "sessions" | "kanban" | "activity";

const AUTHORS = ["Ada", "Babbage", "Cassini", "Dijkstra", "Estrada", "Feynman", "Gauss", "Hopper"];
const TOPICS = ["plan", "build", "review", "deploy", "test", "intent", "reconcile", "observe"];
const STATES = ["todo", "in-progress", "review", "done", "blocked"];
const LANES = ["backlog", "ready", "running", "review", "done"];
const ACTORS = ["alice", "builder", "runner", "sweeper", "reconciler", "archive", "audit", "agent-27"];
const VERBS = ["declared", "enqueued", "scheduled", "started", "finished", "failed", "retried", "reconciled", "archived", "expired"];
const TARGETS = ["task", "intent", "memory", "sandbox", "lease", "delivery", "packet", "run", "snapshot", "checkpoint"];
const STATUSES = ["ok", "warn", "error", "info", "timed-out"];
const STATUS_COLOR: Record<string, string> = {
  ok: "var(--fx-status-ok, #3fb27f)",
  warn: "var(--fx-status-warn, #d9a13c)",
  error: "var(--fx-status-err, #d96a5b)",
  info: "var(--fx-status-info, #6aa7d9)",
  "timed-out": "var(--fx-status-to, #b07fcf)",
};

// Deterministic pseudo-random by index — no Math.random, so row ids/payloads are
// stable across runs and paths (ids must be stable for virtualization keys).
function seeded(i: number) {
  let x = (i * 2654435761) ^ 0x9e3779b9;
  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
  const pick = (arr: string[]) => arr[x % arr.length];
  return {
    author: pick(AUTHORS),
    topic: pick(TOPICS),
    state: pick(STATES),
    lane: pick(LANES),
    actor: pick(ACTORS),
    verb: pick(VERBS),
    target: pick(TARGETS),
    status: pick(STATUSES),
    ref: `#${(i * 7919) % 90000}`,
  };
}

// Rows are variable-height for the activity/analytics kind (each timeline entry
// can wrap to a taller cell), fixed 44px otherwise. Deterministic by index so
// the offset table rebuilds identically on every render.
function rowHeightFor(kind: FixtureKind, i: number): number {
  // conversation and kanban are fixed 44px rows; sessions are a fixed title+meta
  // history row; activity is variable-height (each timeline entry can wrap).
  if (kind === "activity") return 44 + (i % 7) * 6;
  if (kind === "sessions") return 64;
  return ROW_H;
}

const CONT: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  width: "100%",
  maxWidth: 1040,
  margin: "0 auto",
  padding: 16,
  color: "var(--cream-mute, #cfd3db)",
  boxSizing: "border-box",
};
const HEAD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 };
const H1: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: "var(--cream, #f5f0e8)" };
const SUB: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.75 };
const VIEWPORT: React.CSSProperties = {
  height: VIEWPORT_H,
  overflowY: "auto",
  position: "relative",
  border: "1px solid var(--line-soft, #2a2f3a)",
  borderRadius: 6,
};
const SEL: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  background: "rgba(106,167,217,.14)",
  pointerEvents: "none" as const,
};
const CELL: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.3,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 2,
  padding: "4px 10px",
  boxSizing: "border-box",
  borderBottom: "1px solid rgba(255,255,255,.06)",
};
const TITLE: React.CSSProperties = { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" };
const BODY: React.CSSProperties = { fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" };
const ACT_TOP: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap", overflow: "hidden" };
const TS: React.CSSProperties = { fontSize: 10, opacity: 0.6, fontVariantNumeric: "tabular-nums", flex: "none" };
const ACTOR: React.CSSProperties = { fontSize: 12, fontWeight: 700, flex: "none" };
const ACT_BODY: React.CSSProperties = { fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", marginTop: 2 };
const BADGE: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700, marginLeft: "auto", flex: "none" };

// Deterministic HH:MM:SS timestamp from the row index (stable across runs).
function tsFor(i: number): string {
  const s = (i * 17) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function rowContent(kind: FixtureKind, i: number, selected: boolean): React.ReactNode {
  const d = seeded(i);
  return (
    <div style={CELL}>
      {selected && <div style={SEL} data-selection-overlay aria-hidden="true" />}
      {kind === "activity" ? (
        <>
          <div style={ACT_TOP}>
            <span style={TS}>{tsFor(i)}</span>
            <span style={ACTOR}>{d.actor}</span>
            <span style={{ ...BADGE, color: STATUS_COLOR[d.status] }}>{d.status}</span>
          </div>
          <div style={ACT_BODY}>
            {d.verb} {d.target} {d.ref} · {d.topic} memory
          </div>
        </>
      ) : kind === "sessions" ? (
        <>
          <div style={TITLE}>Session #{i} · {d.topic}</div>
          <div style={BODY}>completed {tsFor(i)} · builder {d.actor}</div>
        </>
      ) : (
        <>
          <div style={TITLE}>
            {kind === "conversation" ? `${d.author} · ${d.topic} ${d.ref}` : `${d.ref} · ${d.state}`}
          </div>
          <div style={BODY}>
            {kind === "conversation"
              ? `Deterministic fixture message ${i} about ${d.topic} from ${d.author}.`
              : `Kanban row ${i} in lane ${d.lane} (state ${d.state}).`}
          </div>
        </>
      )}
    </div>
  );
}

const KIND_TITLE: Record<FixtureKind, string> = {
  conversation: "10k-message conversation (SEN/thread)",
  sessions: "10k-session history sidebar",
  kanban: "10k-row Kanban/runtime list",
  activity: "10k-row activity / analytics timeline (MEMORY)",
};

export default function LongListFixture({ kind }: { kind: FixtureKind }) {
  // Fixture-owned scroll state is the single source of truth; VirtualList echoes
  // it back via onScrollTopChange so the fixture can display the mounted count.
  const [scrollTop, setScrollTop] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedKeys = useMemo(
    () => (selectedIndex >= 0 ? new Set<string | number>([selectedIndex]) : new Set<string | number>()),
    [selectedIndex],
  );

  // Cumulative start-offset table enables correct virtualization for BOTH
  // fixed-height and variable-height rows. Row index is the STABLE entity key.
  const rowHeight = useMemo(
    () => (kind === "activity" || kind === "sessions" ? (i: number) => rowHeightFor(kind, i) : ROW_H),
    [kind],
  );
  const offsets = useMemo(() => {
    const arr = new Array<number>(QA_FIXTURE_ROWS + 1);
    arr[0] = 0;
    const h = rowHeight;
    for (let i = 0; i < QA_FIXTURE_ROWS; i++) arr[i + 1] = arr[i] + (typeof h === "function" ? h(i) : h);
    return arr;
  }, [rowHeight]);

  const mounted = windowForScroll(offsets, scrollTop, VIEWPORT_H, OVERSCAN).mounted;

  const rows = useMemo(() => {
    const arr: number[] = new Array(QA_FIXTURE_ROWS);
    for (let i = 0; i < QA_FIXTURE_ROWS; i++) arr[i] = i;
    return arr;
  }, []);

  return (
    <section data-fixture={kind} data-rows={QA_FIXTURE_ROWS} data-testid="fx-list" style={CONT}>
      <div style={HEAD}>
        <h1 style={H1}>{KIND_TITLE[kind]}</h1>
        <p style={SUB} data-testid="fx-count">
          windowed render: {mounted} rows mounted of {QA_FIXTURE_ROWS} logical rows
        </p>
      </div>
      <VirtualList<number>
        items={rows}
        getKey={(i) => i}
        rowHeight={rowHeight}
        height={VIEWPORT_H}
        overscan={OVERSCAN}
        ariaLabel={KIND_TITLE[kind]}
        selectedKeys={selectedKeys}
        onSelect={(key) => setSelectedIndex(Number(key))}
        onScrollTopChange={setScrollTop}
        initialScrollTop={scrollTop}
        containerTestId="fx-viewport"
        rowTestId="fx-row"
        viewportStyleOverride={VIEWPORT}
        contentVisibility
        renderRow={({ item, selected }) => rowContent(kind, item, selected)}
      />
    </section>
  );
}