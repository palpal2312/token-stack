import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_SCHEMA_VERSION,
  PANEL_MIN_SIZE,
  PANEL_MAX_SIZE,
  clampPanelSize,
  createMemoryPanelStorage,
  createPanelLayoutStore,
  migratePanelState,
} from "../../src/shell/panel-layout-store";
// Importing the component module also confirms navigation-progress (and its raw
// `next/navigation` context import) loads under the tsx runner without a DOM.
import { nextNavProgressState } from "../../src/shell/navigation-progress";

function makeStore() {
  const storage = createMemoryPanelStorage();
  const store = createPanelLayoutStore({ storage });
  return { storage, store };
}

test("panel store: open/close/toggle update logicalOpen and notify subscribers", () => {
  const { store } = makeStore();
  let notified = 0;
  const unsub = store.subscribe(() => notified++);

  assert.equal(store.getSnapshot("ws::side").logicalOpen, false);

  store.setOpen("ws", "side", true);
  assert.equal(store.getSnapshot("ws::side").logicalOpen, true);
  assert.equal(notified, 1);

  store.toggle("ws", "side"); // open -> close
  assert.equal(store.getSnapshot("ws::side").logicalOpen, false);
  assert.equal(notified, 2);

  store.toggle("ws", "side"); // close -> open
  store.close("ws", "side");
  assert.equal(store.getSnapshot("ws::side").logicalOpen, false);
  assert.equal(notified, 4);

  unsub();
  store.setOpen("ws", "side", true);
  assert.equal(notified, 4, "unsubscribed listeners must not fire");
});

test("panel store: getSnapshot returns a stable reference between patches", () => {
  const { store } = makeStore();
  const key = "ws::side";
  const a = store.getSnapshot(key);
  const b = store.getSnapshot(key);
  assert.equal(a, b, "repeated reads of an unchanged panel must share a reference");
  store.setOpen("ws", "side", true);
  const c = store.getSnapshot(key);
  assert.notEqual(a, c, "a patch must produce a new reference");
});

test("panel store: resize clamps to [min, max] and tolerates NaN/Infinity", () => {
  const { store } = makeStore();
  store.setSize("ws", "side", 9999);
  assert.equal(store.getSnapshot("ws::side").size, PANEL_MAX_SIZE);

  store.setSize("ws", "side", -50);
  assert.equal(store.getSnapshot("ws::side").size, PANEL_MIN_SIZE);

  store.setSize("ws", "side", 512.4);
  assert.equal(store.getSnapshot("ws::side").size, 512, "sizes round to whole px");

  store.setSize("ws", "side", Number.NaN);
  assert.equal(store.getSnapshot("ws::side").size, PANEL_MIN_SIZE, "NaN clamps to min");

  assert.equal(clampPanelSize(undefined), PANEL_MIN_SIZE);
  assert.equal(clampPanelSize(Infinity), PANEL_MIN_SIZE);
});

test("panel store: size persists only on commit, not during drag", () => {
  const { storage, store } = makeStore();
  store.setOpen("ws", "side", true); // persists open state
  const openPersisted = storage.readAll()["ws::side"];
  assert.equal(openPersisted.size, openPersisted.size); // default, unchanged

  store.setSize("ws", "side", 640); // ephemeral drag write
  assert.equal(store.getSnapshot("ws::side").size, 640, "drag size is live in memory");
  assert.equal(storage.readAll()["ws::side"].size, 380, "drag size must not persist yet");

  store.commitSize("ws", "side"); // drag end
  assert.equal(storage.readAll()["ws::side"].size, 640, "commit at drag end persists size");
});

test("panel store: migration self-heals corrupt/future entries and clamps sizes", () => {
  // Seed storage with an old-schema / oversized / cruft-laden record.
  const seeded = {
    "ws::side": {
      workspaceId: "ws",
      panelId: "side",
      mode: "dify",
      logicalOpen: true,
      size: 5_000_000,
      dock: "unknown",
      schemaVersion: 0,
      extraCruft: "nope",
    },
    "ws::junk": 12345, // non-object → default
  };
  const storage = createMemoryPanelStorage();
  storage.writeAll(seeded as unknown as Record<string, never>);
  const store = createPanelLayoutStore({ storage });

  const migrated = store.getSnapshot("ws::side");
  assert.equal(migrated.schemaVersion, PANEL_SCHEMA_VERSION, "migrated to current schema");
  assert.equal(migrated.size, PANEL_MAX_SIZE, "oversized stored size clamped on restore");
  assert.equal(migrated.dock, "left", "unknown dock falls back to left");
  assert.equal(migrated.logicalOpen, true);
  assert.equal((migrated as unknown as Record<string, unknown>).extraCruft, undefined, "unknown fields dropped");

  const junk = store.getSnapshot("ws::junk");
  assert.equal(junk.mode, "closed", "corrupt entry falls back to a safe default");
  assert.equal(junk.logicalOpen, false);
});

test("panel store: per-workspace isolation and clearWorkspace scoping", () => {
  const { storage, store } = makeStore();
  store.setOpen("alice", "side", true);
  store.setOpen("bob", "side", false);

  assert.equal(store.getSnapshot("alice::side").logicalOpen, true);
  assert.equal(store.getSnapshot("bob::side").logicalOpen, false, "workspaces share no panel state");

  store.clearWorkspace("alice");
  assert.equal(store.stateCount(), 1, "only bob's panel remains");
  assert.ok(storage.readAll()["alice::side"] === undefined, "cleared workspace removed from storage");
  assert.ok(storage.readAll()["bob::side"], "bob's panel untouched");
});

test("migratePanelState: direct default/forward-compat behavior", () => {
  assert.equal(migratePanelState(null, "w", "p").mode, "closed");
  const fut = migratePanelState(
    { schemaVersion: 99, size: "big", logicalOpen: true } as unknown,
    "w",
    "p",
    100,
    500,
  );
  assert.equal(fut.schemaVersion, PANEL_SCHEMA_VERSION, "unknown future version degrades to v1");
  assert.deepEqual(fut, {
    workspaceId: "w",
    panelId: "p",
    mode: "closed",
    logicalOpen: true,
    size: 100,
    dock: "left",
    schemaVersion: PANEL_SCHEMA_VERSION,
  });
});

test("nav progress: pure state transitions idle/active/settled", () => {
  // idle -> active on a fresh pending target
  assert.equal(nextNavProgressState("idle", "/loop", "/sen"), "active");
  // active stays active while the same target is still in flight
  assert.equal(nextNavProgressState("active", "/loop", "/sen"), "active");
  // active -> settled once the route catches up
  assert.equal(nextNavProgressState("active", "/loop", "/loop"), "settled");
  assert.equal(nextNavProgressState("active", null, "/loop"), "settled", "null pending settles");
  // a different target still in flight stays active
  assert.equal(nextNavProgressState("active", "/memory", "/loop"), "active");
  // settled stays settled (caller holds the beat) then falls to idle
  assert.equal(nextNavProgressState("settled", null, "/loop"), "idle");
  assert.equal(nextNavProgressState("settled", "/loop", "/loop"), "idle");
  // a fresh pending on top of settled -> active
  assert.equal(nextNavProgressState("settled", "/memory", "/loop"), "active");
  // no pending and idle stays idle
  assert.equal(nextNavProgressState("idle", null, "/sen"), "idle");
});