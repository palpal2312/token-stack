import { test } from "node:test";
import assert from "node:assert/strict";

import { desktopShellV2Enabled } from "./desktop-shell-flag";

test("desktop shell v2 is OFF by default", () => {
  assert.equal(desktopShellV2Enabled({}), false);
  assert.equal(desktopShellV2Enabled({ DESKTOP_SHELL_V2: "0" }), false);
});

test("desktop shell v2 enables only on exact 1/true", () => {
  assert.equal(desktopShellV2Enabled({ DESKTOP_SHELL_V2: "1" }), true);
  assert.equal(desktopShellV2Enabled({ DESKTOP_SHELL_V2: "true" }), true);
  assert.equal(desktopShellV2Enabled({ DESKTOP_SHELL_V2: "TRUE" }), true);
  // A query param or view preference may never flip the shell.
  assert.equal(desktopShellV2Enabled({ DESKTOP_SHELL_V2: "via-view=1" }), false);
});