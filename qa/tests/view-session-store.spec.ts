import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TABS,
  VIEW_SESSION_SCHEMA_VERSION,
  createMemoryViewSessionStorage,
  createViewSessionStore,
  defaultViewSessionState,
  hydrateViewSessionState,
  normalizeRouteUrl,
  routePathname,
} from "../../src/shell/view-session-store";

function makeStore(workspaceId = "ws") {
  const storage = createMemoryViewSessionStorage();
  const store = createViewSessionStore({ workspaceId, storage });
  return { storage, store, workspaceId };
}

const kanban = { moduleId: "kanban", url: "/kanban", titleToken: "nav.kanban" };

test("default state is one SEN/home session, active, schema-versioned", () => {
  const { store } = makeStore();
  assert.equal(store.stateCount(), 1);
  assert.equal(store.activeTab().moduleId, "sen");
  assert.equal(store.getSnapshot().schemaVersion, VIEW_SESSION_SCHEMA_VERSION);
});

test("open reuses a non-pinned tab for the same module+route (semantic reuse)", () => {
  const { store } = makeStore();
  store.open(kanban);
  assert.equal(store.stateCount(), 2);
  const first = store.open(kanban);
  const second = store.open(kanban);
  assert.equal(first.id, second.id, "same module+route reuses the same tab");
  assert.equal(store.stateCount(), 2, "no new tab created on reuse");
});

test("open creates a fresh tab for a different module", () => {
  const { store } = makeStore();
  const a = store.open(kanban);
  const b = store.open({ moduleId: "memory", url: "/memory", titleToken: "nav.memory" });
  assert.notEqual(a.id, b.id);
  assert.equal(store.stateCount(), 3);
});

test("captureMemento then restoreMemento returns the same continuity state (pull-based)", () => {
  const { store } = makeStore();
  store.open(kanban);
  const tab = store.activeTab();
  store.captureMemento(tab.id, "/kanban", { scrollAnchor: "420", queryParams: { q: "hot" } });
  const restored = store.restoreMemento(tab.id, "/kanban");
  assert.deepEqual(restored, { scrollAnchor: "420", queryParams: { q: "hot" } });
});

test("closing the last tab self-heals to the safe SEN/home session", () => {
  const { store } = makeStore();
  const only = store.activeTab();
  store.close(only.id);
  assert.equal(store.stateCount(), 1, "never zero tabs");
  assert.equal(store.activeTab().moduleId, "sen");
});

test("oversized persisted state self-heals to the safe default", () => {
  const tooMany = Array.from({ length: MAX_TABS + 1 }, (_, i) => ({
    moduleId: `m${i}`,
    url: `/m${i}`,
    titleToken: `nav.m${i}`,
    pinned: false,
    history: [`/m${i}`],
  }));
  const raw = { schemaVersion: VIEW_SESSION_SCHEMA_VERSION, workspaceId: "ws", activeTabId: "", tabs: tooMany };
  const healed = hydrateViewSessionState(raw, "ws");
  assert.equal(healed.tabs.length, 1);
  assert.equal(healed.tabs[0].moduleId, "sen");
});

test("corrupt records and future schema versions degrade to the safe default", () => {
  const corrupt = hydrateViewSessionState({ bogus: true }, "ws");
  assert.equal(corrupt.tabs[0].moduleId, "sen");

  const future = hydrateViewSessionState(
    { schemaVersion: 99, workspaceId: "ws", activeTabId: "x", tabs: [] },
    "ws",
  );
  assert.equal(future.tabs[0].moduleId, "sen");
});

test("persisted tab memento strips unknown keys (no secret cargo round-trips)", () => {
  const raw = {
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
    workspaceId: "ws",
    activeTabId: "t1",
    tabs: [
      {
        id: "t1",
        moduleId: "kanban",
        url: "/kanban",
        titleToken: "nav.kanban",
        pinned: false,
        history: ["/kanban"],
        memento: { "/kanban": { scrollAnchor: "10", apiToken: "secret", queryParams: { q: "x" } } },
        schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
      },
    ],
  };
  const store = createViewSessionStore({ workspaceId: "ws", storage: (() => {
    const s = createMemoryViewSessionStorage();
    s.write(JSON.stringify(raw));
    return s;
  })() });
  const mem = store.restoreMemento("t1", "/kanban");
  assert.deepEqual(mem, { scrollAnchor: "10", queryParams: { q: "x" } }, "unknown keys stripped; no secret exposes");
});

test("route normalization and pathname extraction", () => {
  assert.equal(normalizeRouteUrl("kanban"), "/kanban");
  assert.equal(normalizeRouteUrl("/sen/"), "/sen");
  assert.equal(routePathname("/kanban?view=board#top"), "/kanban");
  assert.equal(routePathname("https://x.test/sen?q=1"), "/sen");
});

test("clearWorkspace wipes the store to safe default", () => {
  const { store } = makeStore();
  store.open(kanban);
  store.clearWorkspace();
  assert.equal(store.stateCount(), 1);
  assert.equal(store.activeTab().moduleId, "sen");
});

test("default state factory returns a self-consistent, schema-versioned record", () => {
  const def = defaultViewSessionState("w2");
  assert.equal(def.workspaceId, "w2");
  assert.equal(def.tabs.length, 1);
  assert.equal(def.activeTabId, def.tabs[0].id);
});