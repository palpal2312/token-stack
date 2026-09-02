import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_MODULES,
  DESKTOP_MODULE_SCHEMA_VERSION,
  findModuleByRoute,
  visibleModules,
} from "../../src/shell/desktop-module-registry";

test("module registry is schema-versioned with unique ids and routes", () => {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const m of DESKTOP_MODULES) {
    assert.equal(m.schemaVersion, DESKTOP_MODULE_SCHEMA_VERSION, `module ${m.id} must carry the schema version`);
    assert.ok(!ids.has(m.id), `duplicate module id: ${m.id}`);
    assert.ok(!routes.has(m.route), `duplicate route: ${m.route}`);
    ids.add(m.id);
    routes.add(m.route);
  }
  // The authoritative nav surface must include the workspace shell routes.
  for (const route of ["/sen", "/agent-kanban", "/kanban", "/code-space", "/memory", "/builders", "/goals", "/journal", "/automations", "/loop"]) {
    assert.ok(routes.has(route), `registry is missing shell route ${route}`);
  }
});

test("visibleModules returns every unconstrained module in ascending order", () => {
  const all = visibleModules({ capabilities: [], permissions: [] });
  const orders = all.map((m) => m.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "modules must be sorted by order");
  const routes = all.map((m) => m.route);
  // No capability/permission constraints → code-space stays hidden (needs terminal + code-space.run).
  assert.ok(!routes.includes("/code-space"));
  assert.ok(routes.includes("/sen") && routes.includes("/loop"));
});

test("visibleModules filters by required capabilities", () => {
  const withoutTerminal = visibleModules({ capabilities: [], permissions: ["code-space.run"] });
  assert.ok(!withoutTerminal.some((m) => m.route === "/code-space"));

  const withTerminal = visibleModules({ capabilities: ["terminal"], permissions: ["code-space.run"] });
  assert.equal(withTerminal.find((m) => m.route === "/code-space")?.id, "code-space");
});

test("visibleModules filters by required permissions", () => {
  const withoutApprovals = visibleModules({ capabilities: [], permissions: [] });
  assert.ok(!withoutApprovals.some((m) => m.route === "/automations"));

  const withApprovals = visibleModules({ capabilities: [], permissions: ["approvals.read"] });
  assert.ok(withApprovals.some((m) => m.route === "/automations"));
});

test("visibleModules with full capabilities/permissions exposes the entire shell set", () => {
  const full = visibleModules({
    capabilities: ["terminal", "notifications", "native-dialogs"],
    permissions: ["code-space.run", "approvals.read", "settings.write"],
  });
  assert.equal(full.length, DESKTOP_MODULES.length);
  assert.deepEqual(
    full.map((m) => m.route),
    [...full].sort((a, b) => a.order - b.order).map((m) => m.route),
  );
});

test("findModuleByRoute resolves known routes and rejects unknown ones", () => {
  assert.equal(findModuleByRoute("/sen")?.id, "sen");
  assert.equal(findModuleByRoute("/code-space")?.id, "code-space");
  assert.equal(findModuleByRoute("/does-not-exist"), undefined);
});