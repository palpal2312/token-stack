---
phase: 3
title: "Legacy freeze and archives"
status: pending
priority: P2
effort: ""
dependencies: [1]
---

# Phase 3: Legacy freeze and archives

## Overview
The FirstMate JSONL writer becomes inert by construction and the legacy archive
policy is documented with a second backup cycle.

## Related Code Files
- Modify: firstmate chat route writer guards; docs for archive policy.
- Run: backfill dry-run + a second backup cycle hash-verify.

## Implementation Steps
1. Make the JSONL append path fail closed unless an explicit legacy flag is set.
2. Document archive/retention policy (7-day cycle, hash manifest, location).
3. Run a second backup cycle + `sha256sum -c` verification.

## Success Criteria
- [x] No silent JSONL append in default mode. (_evidence: see CLOSED_GO record)
- [x] Second backup hash-verified; policy documented. (_evidence: see CLOSED_GO record)
## Risk Assessment
Rollback need — signal: canonical outage; response: legacy remains recoverable
from the frozen archive, documented restore drill.
