# S13 Phase 2 — desktop-shell preview enable receipt

## Status
Preview enablement exercised on the dev host (staging seat = loopback) via the
1809 enable-gate mechanics (env-only flip, request-time checked). Production
flip NOT performed — remains owner-authorized per the enable-gate plan.

## Evidence (production build, `next start`)

| Probe | Result |
|---|---|
| Flag OFF: `/settings` | 200, `Settings are unavailable…` placeholder count **1** (legacy default) |
| Flag ON (`DESKTOP_SHELL_V2=1`): `/settings` | 200, placeholder count **0**, `Schema …workspace.runtime` header **1** (desktop-shell surface mounts) |

The flag is the only differentiator; rollback is a single env unset (the S11/1809
gate documents this). No SLO probes wired on this dev seat (SLO placement is the
staging-host step per ops-prep 1d).

## Next
Phase 3 debt pass (tsc baseline; read-path suites; daemon dev-loop) then Phase 4
close gate.

JOB_DONE: S13 Phase 2 preview-enable exercised and recorded; production flip stays gated.
