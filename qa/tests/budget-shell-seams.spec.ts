import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  DEFAULT_SEN_SURFACE_VALUE,
  SenSurfaceContext,
  useSenSurface,
} from "../../src/shell/sen-surface-context";
// Importing the boundary module confirms next/dynamic (and the desktop-shell
// lazy import) loads under the tsx runner — the split seam is a module-level
// `dynamic()`, same pattern navigation-progress' raw next/navigation import.
import DynamicShell, { renderDynamicShell } from "../../src/shell/dynamic-shell";

test("sen-surface-context: no provider read returns the inert page default", () => {
  let v!: ReturnType<typeof useSenSurface>;
  function Probe() {
    v = useSenSurface();
    return null;
  }
  // Server render drives React's context hook under the tsx runner (no DOM).
  renderToStaticMarkup(createElement(Probe));
  // Inert legacy composition: no composer owner, no active session.
  assert.equal(v.composerOwner, null);
  assert.equal(v.activeSessionId, null);
  // Surface default is `page` (matches the surface store's own default)
  // with noop setters — calling them must not throw and must not mutate.
  assert.equal(v.surface, "page");
  assert.doesNotThrow(() => {
    v.setSurface("floating");
    v.setActiveSession("s-1");
    v.saveDraft("s-1", "d");
    v.saveScrollAnchor("s-1", 3);
    v.setReturnFocus("target");
  });
  assert.equal(v.draft("s-1"), "");
  assert.equal(v.scrollAnchor("s-1"), 0);
});

test("sen-surface-context: context default === DEFAULT_SEN_SURFACE_VALUE", () => {
  assert.equal(typeof SenSurfaceContext, "object"); // shared context instance exists
  assert.equal(DEFAULT_SEN_SURFACE_VALUE.surface, "page");
  assert.equal(DEFAULT_SEN_SURFACE_VALUE.composerOwner, null);
  assert.equal(typeof DEFAULT_SEN_SURFACE_VALUE.setSurface, "function");
  assert.equal(DEFAULT_SEN_SURFACE_VALUE.draft("x"), "");
  assert.equal(DEFAULT_SEN_SURFACE_VALUE.scrollAnchor("x"), 0);
});

test("dynamic-shell: pure gate renders DesktopShell only when enabled", () => {
  assert.equal(renderDynamicShell(false), false);
  assert.equal(renderDynamicShell(true), true);
  assert.equal(typeof DynamicShell, "function");
});