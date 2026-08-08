// The CLI registry: one module per CLI, discovered here into the catalog the
// rest of the app reads through allClis()/cliSpec()/defaultBinFor().
//
// Adding a CLI means adding one file next to this one and one import below —
// no other module should need to know the catalog grew. `registerCliSpec`
// exists so the QA suite can prove that: it adds a spec at runtime exactly the
// way a future dynamic loader would, without touching this list.
//
// The order of CLIS is the order the /builders page offers CLIs in — append
// new CLIs, don't sort.

import { config } from "../../config";
import type { CliSpec } from "./base";
import { claude } from "./claude";
import { codex } from "./codex";
import { kimi } from "./kimi";
import { grok } from "./grok";
import { antigravity } from "./antigravity";
import { cursor } from "./cursor";
import { openclaw } from "./openclaw";
import { hermes } from "./hermes";
import { opencode } from "./opencode";
import { fcc } from "./fcc";
import { fixture } from "./fixture";
import { fixtureClaudeJson } from "./fixtureClaudeJson";
import { fixturePty } from "./fixturePty";

const CLIS: CliSpec[] = [
  claude, codex, kimi, grok, antigravity, cursor, openclaw, hermes, opencode, fcc, fixture, fixtureClaudeJson, fixturePty,
];

const BY_ID = new Map(CLIS.map((c) => [c.id, c]));

export function allClis(): CliSpec[] { return CLIS; }
export function cliSpec(id: string): CliSpec | null { return BY_ID.get(id) ?? null; }

/**
 * Register a spec at runtime. A spec with an id already in the catalog
 * replaces it — that is what makes the QA override (and any future hot-reload)
 * able to shadow a built-in instead of forking the catalog.
 */
export function registerCliSpec(spec: CliSpec): void {
  if (BY_ID.has(spec.id)) {
    const i = CLIS.findIndex((c) => c.id === spec.id);
    CLIS[i] = spec;
  } else {
    CLIS.push(spec);
  }
  BY_ID.set(spec.id, spec);
}

/** Remove a spec added with registerCliSpec. Built-ins should stay put. */
export function unregisterCliSpec(id: string): void {
  const i = CLIS.findIndex((c) => c.id === id);
  if (i >= 0) CLIS.splice(i, 1);
  BY_ID.delete(id);
}

/** The CLI's default binary from global config, before any per-profile override. */
export function defaultBinFor(spec: CliSpec): string | null {
  if (spec.binOf) {
    const target = BY_ID.get(spec.binOf);
    return target ? defaultBinFor(target) : null;
  }
  if (spec.resolveBin) {
    const r = spec.resolveBin();
    if (r) return r;
  }
  if (!spec.configKey) return null;
  const v = (config as unknown as Record<string, unknown>)[spec.configKey];
  return typeof v === "string" && v ? v : null;
}
