# S11 Phase 3 — desktop-shell vertical slice receipt

## Status

**DONE.** Flag plumbing, shell store slice, AND live page smoke verified via a
production build (`next build` + `next start`; see "Smoke (production build)"
below). The desktop shell v2 remains **OFF by default** (`DESKTOP_SHELL_V2`
unset) and the production default stays byte-equivalent to the legacy shell. No
release/cutover; `legacy_writer: disabled`, `phase_21: blocked` preserved.

## Done (merged to master `b2c0daf`)

- `fix(shell)`: `usePanel` gained `getServerSnapshot` (third argument of
  `useSyncExternalStore`), removing the SSR hydration fallout the rewrite
  review flagged when the flag is ON — consistent with the sibling bindings.
- `test(shell)`: `desktop-shell-flag.test.ts` — flag is OFF without env, enables
  only on exact `1`/`true`, never on query/view values. Shell suites now 7/7
  (flag + view-session emit regression + intent-prefetch).

## Verified

| Check | Result |
|---|---|
| flag semantics (node:test) | 7/7 pass |
| `desktopShellV2Enabled()` default | OFF (empty env, `0`) |
| SSR binding (getServerSnapshot present) | fixed |
| S10 regression | 33/33 pass (post-merge, unaffected) |

## Smoke (production build) — PASSED

`npx next dev` on this Windows host panics in Turbopack while compiling
`src/app/globals.css` (CSS worker subprocess exits `0xc0000142`). The working
toolchain is the **production build with sandbox off**: `next build`
(AGENTIC_OS_NEXT_DIST_DIR=.next-qa-build) compiled successfully in ~31s and
type-checks. Two build-health fixes landed for this: `settings/page.tsx`
empty snapshot now satisfies `EffectiveConfigExplanationDTO` (`restartFields`,
`requiresRestart`, `capabilityDigest`), and `llmops/redaction.ts` re-exports
`RedactionClass` (commit `d39224c`).

Live probes via `next start`:

| Probe | Result |
|---|---|
| flag OFF: `/` | 307 → `/sen?tab=mission` (legacy landing, 200) |
| flag OFF: `/settings` | contains `Settings are unavailable while the desktop shell flag is off` |
| flag ON (`DESKTOP_SHELL_V2=1`): `/settings` | 200, placeholder count 0, `Schema …workspace.runtime` header rendered — `SchemaSettingsView` (desktop-shell branch) mounts |

Difference is the flag itself: OFF ⇒ the placeholder surface (production
default byte-equivalent to legacy), ON ⇒ the shell-flagged surface exercises
the slice with the honest empty read-path snapshot.

## Next action

S11 close gate (Phase 4): dispatch an independent S11 arbiter to review the
smoke evidence, chain, and receipt; GO authorizes `CLOSED_GO` for S11. No
release/cutover anywhere; Phase 12 remains separately gated.

JOB_DONE: S11 Phase 3 complete — flag/SSR verified, live smoke passed via production build; close-gate arbitration next.