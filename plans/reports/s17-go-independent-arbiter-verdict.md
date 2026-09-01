# S17 packaging independent arbiter verdict

## Authority and decision

Independent fresh-session arbiter (not the author, and not the prior NO_GO
arbiter) reviewing committed bytes at `git rev-parse HEAD` =
`8a82b220a18dc683b53503f532d4e487f0ee4031` on branch `master`, 2026-09-01.
Scope: S17 one-command packaging per `plans/260901-1451-s17-packaging/plan.md`.
This verdict carries no release, cutover/flip, legacy-writer enablement,
Finalize, or Phase 21 authority of any kind.

**Verdict: GO — S17 packaging closes as GO.**

The prior arbiter's NO_GO at `1e0fe2c` recorded 5 blockers. All 5 are
remediated on committed bytes at `8a82b22`. All regression gates and control
invariants hold. Every acceptance condition is met, so GO is available.

## Checks and outcomes

1. **Dockerfile runtime boot** — `Dockerfile` runtime stage now copies
   `server.ts` (line 33), `src/` (line 34), `tsconfig.json` (line 35) in
   addition to `.next` (28), `public` (29), `package.json`/lock (30),
   `node_modules` (31), `next.config.*` (32). `CMD ["sh","-c","sen-plane & exec
   npm start"]` → `npm start` = `tsx server.ts --prod` (package.json): every
   path that script needs is present. `tsx ^4.23.5` is a devDependency,
   installed by `npm ci` in the `nodebuild` stage (NODE_ENV not force-set
   there) and copied wholesale with node_modules, so the tsx binary exists in
   the runtime stage. `server.ts` imports `./src/lib/dashboard` and
   `./src/lib/herdrTerminalWs` — both shipped inside `src/`. `sen-plane.exe`
   is copied from the `go` stage to `/usr/local/bin/sen-plane`. Runtime ENV
   supplies HOST/PORT/DAEMON defaults; HEALTHCHECK uses node, present in
   `node:24-bookworm-slim`. Boot path complete by inspection. PASS
   (inspection-level — Docker exec unavailable on this host; the
   `container-smoke` CI job in ci.yml remains the live runtime gate and is now
   runnable as written).
2. **Restore cadence doc** — `docs/backup-restore-cadence.md`: 573 bytes
   (> 200); content covers cycle (nightly + before/after flip, 7-day
   retention), verify (`sha256sum -c backup-manifest.sha256` from manifest
   root), restore drill (copy back + hash-verify + canonical chat GET
   round-trip; last drill 9/9 OK 2026-09-01), and cadence. Sane. PASS.
3. **Env template names-only** — `.env.example`: 11 rows, all bare env NAMES
   with empty `=` placeholders; `SEN_CHAT_LEGACY_WRITER=` carries `# DO NOT
   SET`; no literal runtime values (no ports, hosts, paths, or dist dir). PASS.
4. **One-command runner + README** — `scripts/run-s17.ps1` (param-validated
   Native/Container): Native builds `go/bin/sen-plane.exe` if missing, starts
   the daemon first via `Start-Process` (backgrounded), then runs `npm run
   dev` as the foreground process; the `finally` block stops the daemon child
   on Ctrl+C. Container mode prints the image build + run commands. README
   `## S17 quickstart (one command)` section present (Native + Container +
   env-names + legacy-writer note). PASS.
5. **Regression/control gates** — all hold:
   - `npm run test`: 58 tests, 58 pass, 0 fail (exit 0).
   - `cd go && go build ./... && go vet ./... && go test ./cmd/sen-plane
     ./internal/localdb/product`: build OK, vet OK, both packages ok.
   - `npx tsc --noEmit`: exit 0, 0 errors.
   - `legacy_writer: enabled` in src/+go/: **0** hits.
   - `phase_21: enabled` in src/+go/: **0** hits.
   - Legacy writer still frozen: `src/app/api/firstmate/chat/route.ts`
     returns HTTP 410 unless `SEN_CHAT_LEGACY_WRITER=== "1"`.
   - `newos-receipt-verify.ps1` on `s10-phase5-closeout-receipt.md` +
     `s10-phase5-current-byte-close-packet.md`: **verdict PASS** for both
     (exit 0, JOB_DONE markers present, all pinned SHA-256 entries match).
   - CLOSED_GO records present and valid: `s16-CLOSED_GO-record.md`,
     `s15-CLOSED_GO-record.md`, `s12-phase12-CLOSED_GO-record.md`.

## SHA-256 pins (S17 artifacts at HEAD `8a82b22`)

| Path | SHA-256 |
|---|---|
| Dockerfile | 2bc7f6c61f97a8c0da5b64a9ed799b4ddefb733a71f594c66c5712fefab38419 |
| .dockerignore | 24f805b5eaaecb2e0bc67453b2e7162310f97c68bf43c29cb8a2bbf551617490 |
| .env.example | f0c24cdee68b1990fb5636935591712c829d07313c43be4517d9ed42e60a7a4a |
| scripts/run-s17.ps1 | 7095d28c3e2969139aba43c0e56310493944a88585459c6f9ed31469163fa65b |
| docs/backup-restore-cadence.md | 066b230abf5683868ba0da074266da81db0a85da691a4602c2cef0cf28323dbe |
| .github/workflows/ci.yml | c310484ac297c2b17d266016d131d2b511951c03e70466fddfd9470d3888f658 |

## Controls (hard invariants, unchanged)

`legacy_writer: disabled` · `phase_21: blocked`. Legacy JSONL writer still
410-gated behind `SEN_CHAT_LEGACY_WRITER=1`; no release or Phase 21 authority
exercised. This verdict changes none of it.

## Scope note

GO covers the S17 one-command packaging commitment only (Dockerfile runtime
boot, env template, native runner, README quickstart, restore cadence doc, CI
container-smoke gate). It does not open Phase 21, release, Finalize, or
legacy-writer enablement — those require their own authority. The live
container boot proof belongs to the `container-smoke` CI job (Docker exec
unavailable on this host); the runtime stage was verified complete by
inspection of every path the boot script touches.

JOB_DONE: S17 close-gate arbitration complete — GO on committed bytes at
`8a82b22`; prior NO_GO blockers (1e0fe2c) all remediated; no remaining
blocking findings.