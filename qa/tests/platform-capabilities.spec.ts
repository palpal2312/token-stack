import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_CONTRACT_VERSION,
} from "../../src/platform/platform-capabilities";
import { createWebLocalAdapter, webLocalAdapter, type WebBrowserHost } from "../../src/platform/web-local-adapter";

const idleHost = (over: Partial<WebBrowserHost> = {}): WebBrowserHost => ({
  open: () => true,
  canNotify: () => true,
  requestNotificationPermission: async () => "granted",
  ...over,
});

test("web-local adapter reports a narrow, platform-neutral capability surface", () => {
  const adapter = createWebLocalAdapter(idleHost());
  const c = adapter.capabilities;
  assert.equal(c.contractVersion, PLATFORM_CONTRACT_VERSION);
  assert.equal(c.kind, "web-local");
  assert.equal(c.canOpenExternalUrl, true);
  // Web-local must NOT claim system-terminal, directory, or runtime health.
  assert.equal(c.canOpenSystemTerminal, false);
  assert.equal(c.canSelectDirectory, false);
  assert.equal(c.canReportRuntimeHealth, false);
});

test("app info is surfaced from the supplied info", () => {
  const adapter = createWebLocalAdapter(idleHost(), { origin: "https://example.test", version: "9.9.9" });
  assert.deepEqual(adapter.capabilities.appInfo, { origin: "https://example.test", version: "9.9.9" });
});

test("openExternalUrl dispatches to the host only for non-empty urls", () => {
  let opened: string | undefined;
  const adapter = createWebLocalAdapter(idleHost({ open: (url) => { opened = url; return true; } }));
  assert.deepEqual(adapter.openExternalUrl("https://example.test"), { dispatched: true });
  assert.equal(opened, "https://example.test");
  // Empty url ⇒ host must not be called.
  let calls = 0;
  const adapter2 = createWebLocalAdapter(idleHost({ open: () => { calls += 1; return true; } }));
  assert.deepEqual(adapter2.openExternalUrl(""), { dispatched: false });
  assert.equal(calls, 0);
});

test("notify is quiet when the host lacks a notification API", async () => {
  const adapter = createWebLocalAdapter(idleHost({ canNotify: () => false }));
  assert.deepEqual(await adapter.notify("t", "b"), { shown: false, reason: "notification API unavailable" });
});

test("notify requires granted permission before presenting", async () => {
  const denied = createWebLocalAdapter(idleHost({ requestNotificationPermission: async () => "denied" }));
  const deniedResult = await denied.notify("t");
  assert.equal(deniedResult.shown, false);
  assert.match(deniedResult.reason ?? "", /denied/);

  let presented = false;
  const granted = createWebLocalAdapter(
    idleHost({ requestNotificationPermission: async () => "granted" }),
  );
  // Stub the global Notification constructor so the adapter can present one.
  const Ctor = (globalThis as Record<string, unknown>).Notification;
  function FakeNotification(this: unknown, title: string) { presented = title === "ok"; }
  (globalThis as Record<string, unknown>).Notification = FakeNotification as unknown;
  try {
    assert.deepEqual(await granted.notify("ok", "body"), { shown: true });
    assert.equal(presented, true);
  } finally {
    (globalThis as Record<string, unknown>).Notification = Ctor;
  }
});

test("directory selection and runtime health are unavailable placeholders", async () => {
  const adapter = createWebLocalAdapter(idleHost());
  const dir = await adapter.selectDirectory();
  assert.equal(dir.path, null);
  assert.equal(adapter.capabilities.canSelectDirectory, false);

  const health = await adapter.runtimeHealth();
  assert.equal(health.available, false);
  assert.equal(adapter.capabilities.canReportRuntimeHealth, false);
});

test("default exported adapter is a concrete web-local adapter", () => {
  assert.equal(webLocalAdapter.capabilities.kind, "web-local");
});