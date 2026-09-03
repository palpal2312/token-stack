---
title: Plan Token-Stack comprehensive testing
date: 2026-09-03
summary: "Created an isolated, security-aware five-phase Token-Stack QA roadmap."
---

# Plan Token-Stack comprehensive testing

﻿## What happened
Created a deep, repository-scoped Token-Stack test strategy after inspecting the current core modules, standalone Node test scripts, PowerShell dispatcher/setup/verifier, registry, and CI workflow.

## Findings
Existing Token-Stack tests are not wired to the CI `npm run test` command and some default paths can depend on user-home state or a globally installed CLI. The planned replacement is an isolated offline suite with separate opt-in live verification and redacted receipts.

## Decision
The plan is intentionally limited to Token-Stack (`core/`, `bin/`, `skills/`, registry, and tests), leaving the co-located Agentic OS application and the pending Sub2API gateway plan untouched.

## Next steps
Review and approve the five phases, then execute from Phase 1: baseline and safety contract.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
