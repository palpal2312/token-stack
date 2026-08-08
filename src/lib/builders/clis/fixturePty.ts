import type { CliSpec } from "./base";
import { fixture } from "./fixture";

// Twin of the QA fixture that opts into the PTY spawn path (requiresPty), so
// the suite can prove the node-pty chat lane end-to-end with the same
// zero-cost echo binary — no account, no tokens, deterministic.
export const fixturePty: CliSpec = {
  ...fixture,
  id: "fixture-pty",
  label: "Test fixture (PTY)",
  requiresPty: true,
  notes: "QA twin of the fixture spec with requiresPty: true — exercises the node-pty chat lane. "
    + "Filtered out of every CLI list like the plain fixture.",
};
