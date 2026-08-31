import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPanelLayoutStore,
  createMemoryPanelStorage,
  defaultPanelState,
  PANEL_DEFAULT_SIZE,
  PANEL_MIN_SIZE,
  PANEL_MAX_SIZE,
} from "./panel-layout-store";

test("mutators notify subscribers and clamp sizes", () => {
  const store = createPanelLayoutStore();
  let calls = 0;
  store.subscribe(() => void calls++);

  store.setOpen("ws-1", "p-1", true);
  store.toggle("ws-1", "p-1");
  store.setMode("ws-1", "p-1", "chat");
  store.setSize("ws-1", "p-1", 10);
  store.commitSize("ws-1", "p-1");
  store.close("ws-1", "p-1");
  store.applyPanelIntent("ws-1", "p-1", "open");

  // Every mutator above emits (commitSize is persistence-only); applyPanelIntent
  // emits twice (setOpenLocal sync + its own emit).
  assert.ok(calls >= 7, `expected >=7 subscriber notifications, got ${calls}`);

  // Out-of-range sizes clamp on write, not stored raw.
  store.setSize("ws-1", "p-1", 10 ** 6);
  assert.equal(store.getSnapshot("ws-1::p-1").size, PANEL_MAX_SIZE);
  store.setSize("ws-1", "p-1", -5);
  assert.equal(store.getSnapshot("ws-1::p-1").size, PANEL_MIN_SIZE);
});

test("memory storage round-trips persisted state; setSize stays ephemeral", () => {
  const storage = createMemoryPanelStorage();
  const store = createPanelLayoutStore({ storage });

  store.setOpen("ws-2", "p-2", true);
  assert.equal(store.persisted()["ws-2::p-2"].logicalOpen, true);
  assert.equal(storage.readAll()["ws-2::p-2"].logicalOpen, true);

  // Drag-time size write is memory-only until commitSize/checkpoint.
  store.setSize("ws-2", "p-2", 500);
  assert.equal(storage.readAll()["ws-2::p-2"].size, PANEL_DEFAULT_SIZE);
  store.commitSize("ws-2", "p-2");
  assert.equal(storage.readAll()["ws-2::p-2"].size, 500);

  // A fresh store hydrates from the same storage with clamped sizes.
  const revived = createPanelLayoutStore({ storage });
  assert.equal(revived.getSnapshot("ws-2::p-2").logicalOpen, true);
  assert.equal(revived.getSnapshot("ws-2::p-2").size, 500);
});

test("applyPanelIntent drives the phase machine and keeps logicalOpen in step", () => {
  const store = createPanelLayoutStore();

  assert.equal(store.getPanelPhase("ws-3", "p-3"), "closed");
  assert.equal(store.applyPanelIntent("ws-3", "p-3", "open"), "opening");
  assert.equal(store.applyPanelIntent("ws-3", "p-3", "settle"), "open");
  assert.equal(store.applyPanelIntent("ws-3", "p-3", "resize"), "resizing");
  assert.equal(store.applyPanelIntent("ws-3", "p-3", "close"), "closing");
  assert.equal(store.applyPanelIntent("ws-3", "p-3", "settle"), "closed");

  // Logical visibility follows the machine's settled target.
  assert.equal(store.getSnapshot("ws-3::p-3").logicalOpen, false);

  // Unknown panel read resets to the safe default; hydrate tolerates cruft.
  assert.deepEqual(store.getSnapshot("ws-3::unknown"), defaultPanelState("ws-3", "unknown"));
});