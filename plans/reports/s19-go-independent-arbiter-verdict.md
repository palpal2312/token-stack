# S19 close-gate independent arbiter verdict

## Status
**GO** — S19 shell-rollout-on-this-host scope closes 2026-09-01.
Independent arbiter, read-only (no commits/edits beyond this verdict).
HEAD `298928b032dc28c845c73918a3ef08d245ec7703`.

## Checks + outcomes

1. **Scope** — `plans/260901-1635-s19-shell-rollout/plan.md`: host-only per-process
   env enablement (`DESKTOP_SHELL_V2=1`), OFF stays legacy, rollback = unset env.
   No production flip beyond this host, no release / Phase 21 authority.
   `plans/reports/s19-rollout-receipt-260901.md` DONE, evidence + JOB_DONE marker.
2. **Tests** — `npx --no-install tsx --test src/shell/desktop-shell-flag.test.ts`:
   **2 pass / 0 fail** (OFF default; ON only on exact 1/true). `npx --no-install
   tsc --noEmit -p tsconfig.json`: **0 errors** (exit 0).
3. **Rollout switch** — `scripts/run-s17.ps1`: `[switch]$Shell` (line 8) sets
   `$env:DESKTOP_SHELL_V2 = '1'` (line 24) in the shell that runs `npm run dev`,
   so the app process inherits it. Default path (no `-Shell`) leaves it unset →
   legacy surface. Verified.
4. **Controls** — `legacy_writer:\s*enabled` in src/ and go/ = **0 hits**;
   `phase_21:\s*enabled` = **0 hits**. FirstMate 410 guard present
   (`src/app/api/firstmate/chat/route.ts:97-100`: unless
   `SEN_CHAT_LEGACY_WRITER=1`, returns 410 "legacy JSONL writer frozen (S16)").
5. **Chains** — `newos-receipt-verify.ps1` **PASS** on
   `plans/reports/sprint10/s10-phase5-closeout-receipt.md` and
   `plans/reports/sprint10/s10-phase5-current-byte-close-packet.md`: all
   dependency SHA-256 hashes match, JOB_DONE present on both. CLOSED_GO records
   present S18 → S12..Phase12: s18, s17, s16, s15, s14, s13, s12,
   s12-phase12 (`plans/reports/*-CLOSED_GO-record.md`).

## SHA-256 pins (verified this session)

- `plans/260901-1635-s19-shell-rollout/plan.md`
  `4cba8a40d6c1d2ab438d562f6f1c769299a39c1014483900847a6374f6c2ce8b`
- `plans/reports/s19-rollout-receipt-260901.md`
  `36dc8ee6405bc471374efe6991572251ed6f9eebcb8ae47460a28a65beb71595`
- `src/shell/desktop-shell-flag.test.ts`
  `5ec43244fb0a467007b23abf45e7a435bc2e7f1f9d6df8c8f48cee4a18801811`
- `scripts/run-s17.ps1`
  `514e14f02182434ba224473b897f37ae692b6a577ce00e4b6d831b419419220e`

## Controls (unchanged invariants)
`legacy_writer: disabled` · `phase_21: blocked`. SEN chat unaffected by the
shell flag. This GO does NOT open release; production flip remains owner-gated
beyond this host.

JOB_DONE: S19 shell-rollout-on-this-host closed GO (independent).