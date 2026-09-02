---
phase: 4
title: "Current-byte verification and final arbitration"
status: pending
priority: P1
effort: "2-4h"
dependencies: [3]
---

# Phase 4: Current-byte verification and final arbitration

## Overview

Produce a master-byte test packet and canonical manifest, then let a fresh,
independent Pi arbiter re-execute—not merely inspect—the close gates.

## Requirements

- [ ] Lane B uses a fresh clean detached verification worktree at recorded master HEAD/tree; it runs C1/C3 tests plus C2 workflow graph suite and `tsc --noEmit`. (OPEN: historical plan dir; see roadmap track record)
- [ ] Snapshot checks cover canonical-serialization mutation, allowlisted/unknown key, signature, schema/policy, provenance, expiry, monotonic version, rollback reference, and before/after state equality on every rejection. (OPEN: historical plan dir; see roadmap track record)
- [ ] Lane A promotes the existing contract-arbiter `current-byte-manifest.json` to its named canonical master contract path without material regeneration, then records source/destination hashes, base/HEAD/tree, semantic validation, and a separately scoped manifest receipt commit. (OPEN: historical plan dir; see roadmap track record)
- [ ] Lane C uses a distinct Orca task, terminal, and clean verifier worktree that did not author C5/audit/manifest; it derives hashes itself and independently re-runs every close gate. (OPEN: historical plan dir; see roadmap track record)
- [ ] Scan every manifest/receipt before arbitration for forbidden fields, secret/private-key material, raw paths/logs/prompts, and private identifiers; fail closed on a hit. (OPEN: historical plan dir; see roadmap track record)

- [ ] Lane B executes read-only focused tests against promoted master bytes for C1/C3, signature/expiry/rollback, and reports command/output/hashes. (OPEN: historical plan dir; see roadmap track record)
- [ ] Lane A writes the canonical current-byte manifest only after both promotion receipts and tests settle. (OPEN: historical plan dir; see roadmap track record)
- [ ] Lane C independently re-runs graph, snapshot, consent/quarantine/forbidden-field/dedupe, and manifest checks against master bytes. (OPEN: historical plan dir; see roadmap track record)
- [ ] Final arbitration fails closed when tooling is unavailable or `contracts.ts` remains unresolved. (OPEN: historical plan dir; see roadmap track record)

## Implementation Steps

0. Lane B creates its clean verifier worktree and records its commit/tree before testing; C5 is fenced as candidate-only before the arbiter task begins.
0. Lane A promotes and self-verifies the named manifest with C1/C2/C3 sources/tests/fixtures, promotion/test receipts, hashes, and scan result.
0. The arbiter independently derives its hash list, verifies its HEAD/tree equals the manifest target, and uses a distinct task/terminal/worktree.

1. Lane B produces a read-only verification receipt keyed to the exact master commits/hashes.
2. Lane A builds and self-verifies the canonical manifest: contract bytes, promoted sources/tests/fixtures, promotion receipts, test receipts, versions, and hashes.
3. A fresh Lane C arbiter terminal reads the manifest and mechanically re-executes every owned gate.
4. Arbiter returns GO only if all nine gates, legacy-writer-disabled, Phase-21-blocked, and drift disposition are evidenced.

## Todo

- [ ] Manifest and receipt commits name exact paths, base/HEAD/tree hashes, and no untracked or dirty overlay is in the verification subject. (OPEN: historical plan dir; see roadmap track record)
- [ ] Privacy scan passes for the manifest plus every referenced receipt. (OPEN: historical plan dir; see roadmap track record)

- [ ] No source-worktree receipt is used as a substitute for a master-byte test. (OPEN: historical plan dir; see roadmap track record)
- [ ] Manifest hashes validate against the exact bytes the arbiter tested. (OPEN: historical plan dir; see roadmap track record)
- [ ] Arbiter report identifies commands, pass/fail/unavailable status, and a clear GO/NO-GO. (OPEN: historical plan dir; see roadmap track record)

## Success Criteria

- An independent final arbiter GO exists for implementation bytes, not just Contract v1.

## Risk Assessment

If a user-approved `contracts.ts` disposition is absent, or any scan/tool is unavailable, the only permitted result is NO-GO/BLOCKED.

The unreceipted contracts.ts delta is a hard decision gate. If it is still
unresolved, write a NO-GO/BLOCKED report and do not issue CloseGate.
