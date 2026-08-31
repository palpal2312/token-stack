# S04-L2 Receipt — Sprint 04 Lane 2 (Cursor fallback)

## Status
- **Run**: `run_0c3db1f2dee5` / `orchestrate-260825-sprint04-orca-reconcile`
- **Task**: `task_2ad230532b30`
- **Dispatch**: `ctx_4a3d47ba7b4e`
- **Role**: sole Lane 2 writer (Claude primary fenced)
- **Commits**: none
- **Phase 21**: not started

## Working tree (ownership only)

| Path | Git | Role |
|---|---|---|
| `src/components/HerdrTerminal.tsx` | **M** | Observe-only diagnostics strip |
| `src/lib/agentRuntime/orca-slot-client.ts` | **??** | Typed reconcile/cursor/capability-error projections |
| `src/lib/query/realtime-reconciler.ts` | **??** | `notifyTransportReconnect`, `lastCursor`, `adoptCursor` |
| `src/components/OrcaSlotStatus.tsx` | **??** | Reconnect + capability/cursor observe UI |
| `qa/tests/orca-reconcile.spec.ts` | **??** | Projection/cursor/capability/reconciler checks |
| `qa/tests/orca-reconcile-ui.spec.ts` | **??** | Render checks for reconnect/capability UI |
| `plans/reports/orchestrate-260825-sprint04-orca-reconcile/lane2/` | **??** | This receipt + manifest |

## Tests

```text
npx tsx --test qa/tests/orca-reconcile.spec.ts qa/tests/orca-reconcile-ui.spec.ts
→ pass 18 / fail 0
```

## SHA-256

```
58ce724a8ab092e27cfab5f419a941a235d94d6e17e9a645c6178f3460874fd9  src/lib/agentRuntime/orca-slot-client.ts
33018d05de9d48ad0bd95e6c2583fa2ccd45f64616a4d7734959c8aa48ba88b9  src/lib/query/realtime-reconciler.ts
02c416b2a8f1203e908639501d9757ca9f5671df3abd359c0a3f6095b004ca29  src/components/OrcaSlotStatus.tsx
eea81a6639d7d805adb594df132e3766c631467d98dc304cbf6aabd613bd8322  src/components/HerdrTerminal.tsx
ba4636fed3f36dd2b5b4b5fdf83fd8bc68571a9d9915f29aa3da89bf2fea3b89  qa/tests/orca-reconcile.spec.ts
a5792a1dcec63d5563651c04726dcb0fa646ff41fdb5059a425920106730d2db  qa/tests/orca-reconcile-ui.spec.ts
```

## Limitations

- CodeSpaceView wiring of `parseReconcileProjection` / cursor / capabilityError is out of Lane 2 ownership (not done).
- No live daemon `/api/herdr/slots` e2e; fixture-only checks.
- No commits. Phase 21 not started.

```
JOB_DONE: S04-L2-FB
```
