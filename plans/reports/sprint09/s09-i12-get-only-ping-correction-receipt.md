# Sprint 09 I12 GET-only ping correction receipt

## Summary

The orchestration board is GET-only. The legacy POST ping writer and all client controls that invoked it are removed.

## Input

- Input HEAD: `eb27b702af933e282fdabc590f5ffae572e3a29d`
- Input subject: `promote: board refresh buttons + ping endpoint (S09 lane-c)`

## Change paths

- Deleted `src/app/api/orchestration/ping/route.ts` (legacy POST writer).
- Updated `src/app/orchestration/page.tsx` to remove the refresh control, POST request, and related state/message UI.
- Removed stale untracked fixture directory `qa/fixtures/orchestration-state/preview-home/`.

## Validation

- `git diff --check`: pass (no output).
- `npx --no-install tsx --test src/lib/__tests__/orchestration-state.test.ts src/lib/__tests__/orchestration-board.test.ts`: pass — 23 tests passed, 0 failed, 0 skipped; duration 604.028 ms.
- `npx --no-install tsc --noEmit`: expected baseline failure, unrelated to this correction:
  - `src/app/api/thumbnails/file/route.ts(3,19)`: missing `sharp` module/type declarations.
  - `src/app/api/thumbnails/file/route.ts(52,21)` and `(54,40)`: `Buffer<ArrayBufferLike> | undefined` is not assignable where a defined buffer is required.

## State

- Legacy writer: disabled by deletion of the ping route and its client POST controls.
- Phase 21: blocked; no legacy writer remains available to request worker reports.
- No master promotion was sent.
