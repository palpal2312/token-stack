import { test } from "node:test";
import assert from "node:assert/strict";

import { createViewSessionStore, createMemoryViewSessionStorage } from "./view-session-store";

test("mutators notify subscribers (emit regression)", () => {
  const store = createViewSessionStore({
    workspaceId: "w-test-notify",
    storage: createMemoryViewSessionStorage(),
  });
  let calls = 0;
  store.subscribe(() => void calls++);

  const tab = store.open({ moduleId: "sen", url: "/" });
  store.activate(tab.id);
  store.pin(tab.id);
  store.unpin(tab.id);
  store.setTerminalSession(tab.id, "term-1");

  assert.ok(calls >= 5, `expected >=5 subscriber notifications, got ${calls}`);
});

test("memory storage round-trips persisted view-state", () => {
  const storage = createMemoryViewSessionStorage();
  const store = createViewSessionStore({ workspaceId: "w-test-persist", storage });
  const tab = store.open({ moduleId: "sen", url: "/a" });
  const persisted = store.persisted();
  assert.equal(persisted.activeTabId, tab.id);
  assert.ok(persisted.tabs.some((t) => t.id === tab.id));
  assert.equal(typeof storage.read(), "string");
});