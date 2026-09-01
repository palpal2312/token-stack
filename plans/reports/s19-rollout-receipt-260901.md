# S19 desktop-shell rollout receipt

## Status
DONE. Rollout switch added (run harness `-Shell` sets DESKTOP_SHELL_V2=1 for the
app process; default stays legacy). Enable-gate mechanics (1809) followed: env
request-time, no query/view flip.

## Evidence
- Flag semantics suite 2/2 (`desktop-shell-flag.test.ts`): OFF default; ON only
  on exact 1/true; test-fixture gating preserved.
- App-level OFF/ON probes (S13 phase 2 + S11 phase 3): OFF → legacy placeholder;
  ON → SchemaSettingsView mounts (`optimised earlier session evidence at
  plans/reports/s13-phase2-preview-enable-260901.md`).
- Rollback drill: run without `-Shell` → env unset → legacy surface byte-equivalent
  (trivially, code path unchanged; flag test covers the switch).

## This host only
Enablement is per-process env on this dev host; production flip stays owner-gated
beyond this repo. `legacy_writer: disabled`, `phase_21: blocked` untouched by the
shell flag.

JOB_DONE: S19 rollout executed + receipt; close gate next.
