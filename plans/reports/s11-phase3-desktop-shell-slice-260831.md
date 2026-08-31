# S11 Phase 3 — desktop-shell vertical slice receipt

## Status

**PARTIAL.** Flag plumbing and shell store slice verified; live page smoke
blocked by the dev toolchain in this environment. The desktop shell v2 remains
**OFF by default** (`DESKTOP_SHELL_V2` unset) and the production default stays
byte-equivalent to the legacy shell. No release/cutover; `legacy_writer:
disabled`, `phase_21: blocked` preserved.

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

## Blocked — live page smoke (infra)

`npx next dev` on this Windows host panics in Turbopack while compiling
`src/app/globals.css`: the CSS transform worker subprocess exits
`0xc0000142` (STATUS_DLL_INIT_FAILED) before connect — an environment /
toolchain worker-spawn failure, not a product-code finding. Second attempt
hung with no HTTP response. Evidence of this limitation is retained.

## Next action

Run the page smoke on a working toolchain (webpack build, another machine, or a
fixed Turbopack worker) to capture: default-off `/` renders the legacy shell
(200), and `DESKTOP_SHELL_V2=1` mounts `DesktopShell` — before any claim of the
ON-branch slice. Unit-level slice evidence is complete without it.

JOB_DONE: S11 Phase 3 partial — flag + SSR plumbing verified; live smoke deferred to a working toolchain.