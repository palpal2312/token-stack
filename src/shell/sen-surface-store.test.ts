import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSenSurfaceStore,
  createMemorySenSurfaceStorage,
  composerOwnerFor,
  type SenSurfaceState,
} from "./sen-surface-store";

test("every mutator updates state and notifies subscribers", () => {
  const store = createSenSurfaceStore();
  let notified = 0;
  store.subscribe(() => notified++);

  assert.equal(store.surface("ws-1"), "page");
  assert.equal(store.composerOwner("ws-1"), "page");

  store.setSurface("ws-1", "floating");
  assert.equal(store.surface("ws-1"), "floating");
  assert.equal(store.composerOwner("ws-1"), "floating");

  store.setSurface("ws-1", "none");
  assert.equal(store.composerOwner("ws-1"), null);

  store.setActiveSession("ws-1", "session-42");
  assert.equal(store.getSnapshot("ws-1").activeSessionId, "session-42");
  assert.equal(store.getSnapshot("ws-1").surface, "none", "surface preserved across session switch");

  store.saveDraft("ws-1", "session-42", "hello");
  assert.equal(store.draft("ws-1", "session-42"), "hello");
  store.saveScrollAnchor("ws-1", "session-42", 1234);
  assert.equal(store.scrollAnchor("ws-1", "session-42"), 1234);
  store.setReturnFocus("ws-1", "#inspector");
  assert.equal(store.getSnapshot("ws-1").returnFocusTarget, "#inspector");

  // six mutators, six notifications
  assert.equal(notified, 6);

  store.clearWorkspace("ws-1");
  assert.equal(notified, 7);
  assert.equal(store.stateCount(), 0);
});

test("surface switch preserves per-session continuity state", () => {
  const store = createSenSurfaceStore();
  store.setActiveSession("ws-1", "session-42");
  store.saveDraft("ws-1", "session-42", "draft text");
  store.saveScrollAnchor("ws-1", "session-42", 999);

  store.setSurface("ws-1", "side-panel");

  assert.equal(store.getSnapshot("ws-1").activeSessionId, "session-42");
  assert.equal(store.draft("ws-1", "session-42"), "draft text");
  assert.equal(store.scrollAnchor("ws-1", "session-42"), 999);
});

test("state round-trips through the memory storage", () => {
  const storage = createMemorySenSurfaceStorage();
  const store = createSenSurfaceStore({ storage });
  store.setSurface("ws-1", "floating");
  store.setActiveSession("ws-1", "session-7");
  store.saveDraft("ws-1", "session-7", "drafted");
  store.saveScrollAnchor("ws-1", "session-7", 55);

  // fresh store over the same storage hydrates the persisted record
  const reloaded = createSenSurfaceStore({ storage });
  assert.equal(reloaded.surface("ws-1"), "floating");
  assert.equal(reloaded.getSnapshot("ws-1").activeSessionId, "session-7");
  assert.equal(reloaded.draft("ws-1", "session-7"), "drafted");
  assert.equal(reloaded.scrollAnchor("ws-1", "session-7"), 55);

  // corrupt persisted entries self-heal to the safe default, not a throw
  const corrupt = createMemorySenSurfaceStorage();
  corrupt.writeAll({
    "workspace:ws-2": {
      surface: "bogus",
      drafts: { a: 5 },
      scrollAnchors: { a: Infinity },
      schemaVersion: 99,
    } as unknown as SenSurfaceState,
  });
  const healed = createSenSurfaceStore({ storage: corrupt });
  assert.equal(healed.surface("ws-2"), "page");
  assert.equal(healed.draft("ws-2", "a"), "");
});

test("composerOwnerFor derives surface ownership", () => {
  assert.equal(composerOwnerFor("page"), "page");
  assert.equal(composerOwnerFor("side-panel"), "side-panel");
  assert.equal(composerOwnerFor("floating"), "floating");
  assert.equal(composerOwnerFor("none"), null);
});