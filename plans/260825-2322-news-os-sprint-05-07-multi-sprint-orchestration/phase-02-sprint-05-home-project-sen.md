---
phase: 2
title: "Sprint 05 Home and Project SEN"
status: pending
priority: P1
effort: "32-36 agent-hours; <=48h sprint timebox"
dependencies: [1]
---

# Phase 2: Sprint 05 Home and Project SEN

## Overview

Deliver stable Home/Project SEN identity and context boundaries. Publish an early
contract freeze that allows Sprint 06 and 07 to build concurrently.

## Requirements

- One Home SEN per installation and exactly one logical Project SEN per project.
- Multiple conversations remain replaceable sessions under stable SEN identity.
- Home receives bounded project digests, never raw private project context.
- Crash/restart restores project continuity from SQLite and durable Chat evidence.

## Architecture

Lane 1 owns registry/preferences/digest presentation. Lane 2 owns scoped
conversation-memory-context interfaces. Lane 3 owns uniqueness, privacy and
replacement/restart verification. `S05-G1` pins identity IDs, scope predicates,
digest envelope and session binding before dependent sprint dispatch.

## Related code files

- Create: `go/internal/senidentity/**`
- Create: `src/lib/sen-scope/**`
- Create: `src/app/api/sen/home/**`
- Create: `src/app/api/sen/projects/**`
- Create: `qa/fixtures/sprint05/**`
- Read only until integration: `go/internal/localdb/product/**`, durable Chat/Orca packages

## Implementation steps

1. Lane 1 defines installation/Home/Project registry and bounded digest surface.
2. Lane 2 defines scoped conversation, context-pack and replaceable-session ports.
3. Lane 3 writes uniqueness, cross-project privacy and restart/rebind fixtures.
4. Freeze and hash `S05-G1`; dispatch Sprint 06/07 only after independent check.
5. Finish implementation and UI evidence while dependent sprints progress.
6. Freeze writers, promote current bytes and obtain independent Sprint 05 GO.

## Todo

- [ ] S05-L1 ACTIVE/NEXT/FALLBACK accepted. (OPEN: historical plan dir; see roadmap track record)
- [ ] S05-L2 ACTIVE/NEXT/FALLBACK accepted. (OPEN: historical plan dir; see roadmap track record)
- [ ] S05-L3 ACTIVE/NEXT/FALLBACK accepted. (OPEN: historical plan dir; see roadmap track record)
- [ ] `S05-G1` hash-pinned and independently verified. (OPEN: historical plan dir; see roadmap track record)
- [ ] Home digest privacy and exactly-one Project SEN gates pass. (OPEN: historical plan dir; see roadmap track record)
- [ ] Restart/session replacement recovery passes. (OPEN: historical plan dir; see roadmap track record)
- [ ] Independent Sprint 05 arbiter returns GO. (OPEN: historical plan dir; see roadmap track record)

## Success criteria

Home sees bounded digests; each project restores one SEN with complete local
continuity; no cross-project private payload reaches Home evidence.

## Risk assessment

If dependent work discovers missing identity semantics, stop only dependent
jobs, revise G1 with explicit version bump, rerun its arbiter and update hashes.

## Security considerations

Use allowlisted digest fields and scope predicates. Evidence must never contain
raw project content, credentials or dispatch capabilities.
