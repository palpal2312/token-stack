import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_MODULE_SCHEMA_VERSION,
  DESKTOP_MODULES,
  findModuleByRoute,
  visibleModules,
} from "./desktop-module-registry";

test("findModuleByRoute resolves owned routes and nothing else", () => {
  const sen = findModuleByRoute("/sen");
  assert.ok(sen, "expected /sen to be registered");
  assert.equal(sen.id, "sen");
  assert.equal(sen.schemaVersion, DESKTOP_MODULE_SCHEMA_VERSION);

  assert.equal(findModuleByRoute("/no-such-route"), undefined);
});

test("visibleModules gates on host capabilities", () => {
  // code-space needs the "terminal" capability; without it it must not appear.
  assert.equal(
    visibleModules({ capabilities: [], permissions: ["code-space.run"] }).some(
      (m) => m.id === "code-space"
    ),
    false
  );
  assert.equal(
    visibleModules({ capabilities: ["terminal"], permissions: ["code-space.run"] }).some(
      (m) => m.id === "code-space"
    ),
    true
  );
});

test("visibleModules filters by permission and returns navigation order", () => {
  const allowed = new Set(["settings.write"]);
  const visible = visibleModules({ capabilities: ["terminal"], permissions: ["settings.write"] });

  for (const m of visible) {
    assert.ok(
      m.requiredPermissions.every((p) => allowed.has(p)),
      `${m.id} requires permission ${m.requiredPermissions} the host lacks`
    );
  }
  // permission-gated modules hidden, capability+permission gate together for code-space
  assert.equal(visible.some((m) => m.id === "automations"), false);
  assert.equal(visible.some((m) => m.id === "builders"), true);
  assert.equal(visible.some((m) => m.id === "code-space"), false);

  const orders = visible.map((m) => m.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));

  // a full host sees every registered module, still in order
  const allCaps = new Set(DESKTOP_MODULES.flatMap((m) => m.requiredCapabilities));
  const allPerms = new Set(DESKTOP_MODULES.flatMap((m) => m.requiredPermissions));
  const all = visibleModules({ capabilities: [...allCaps], permissions: [...allPerms] });
  assert.equal(all.length, DESKTOP_MODULES.length);
  assert.deepEqual(
    all.map((m) => m.id),
    [...DESKTOP_MODULES].sort((a, b) => a.order - b.order).map((m) => m.id)
  );
});