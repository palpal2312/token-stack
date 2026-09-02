# Phase 02: Runaway Loop Breaker & Smart Waterfall Failover

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Frameworks: `guardrails-ai/guardrails`, `NVIDIA/NeMo-Guardrails`, `BerriAI/litellm`

## Overview
- **Date**: 2026-09-03
- **Description**: Implement an active runtime circuit breaker that prevents infinite tool calling loops and provides transparent waterfall failover when a cloud provider returns 429 rate limit or quota exhaustion.
- **Priority**: P1
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Agents frequently get trapped in circular failure loops (e.g. repeated edit-fail cycles), burning hundreds of thousands of tokens without user awareness.
- Cloud providers enforce allocation boundaries (e.g. Alibaba MaaS weekly token quota, Google Antigravity 429 TPM cooldowns).
- An automated circuit breaker stops runaway cost, while transparent failover routes to secondary providers without interrupting the active coding session.

## Requirements
1. Implement `core/guardrail.cjs`:
   - **Loop Detection**:
     - Computes SHA256 hashes of `(tool_name + tool_args)`.
     - Tracks sliding window of the last 6 tool executions.
     - If the exact same hash repeats 3 consecutive times, intercepts the execution and injects an intervention directive:
       `[CIRCUIT BREAKER: Repeated identical action detected 3 times. Change strategy, inspect surrounding files, or ask the user.]`
   - **Token Spend Cap**:
     - Checks cumulative token consumption.
     - Triggers user-configurable warning at 50k tokens and hard pause at 150k tokens per session.
   - **Waterfall Multi-Provider Failover**:
     - Reads priority list from `token-stack.registry.json` (`routing_tiers`).
     - On HTTP 429 (`Throttling.AllocationQuota`, `rate_limit_exceeded`) or 503 (`No available accounts`), immediately retries with the next healthy provider in the tier within 500ms.

## Architecture
```text
[Incoming Tool Request] ──> [Loop Hash Tracker]
                                    │
               ┌────────────────────┴────────────────────┐
               ▼ (Hash repeats 3x)                       ▼ (Normal execution)
   [Inject Circuit Breaker Warning]              [Forward to Upstream]
                                                         │
                                            ┌────────────┴────────────┐
                                            ▼ (HTTP 429 / Quota)      ▼ (HTTP 200)
                                    [Waterfall Failover]          [Return Stream]
                                    (Kimi -> Sub2API -> Direct)
```

## Related Code Files
- `C:\Users\ADMIN\Documents\token-stack\core\guardrail.cjs`
- `C:\Users\ADMIN\Documents\token-stack\token-stack.registry.json`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`

## Implementation Steps
1. Create `core/guardrail.cjs` with loop hashing and failover dispatcher.
2. Update `token-stack.registry.json` to define `routing_tiers`.
3. Integrate into proxy request/response lifecycle.
4. Test with simulated 429 response and verify seamless switch to backup profile.

## Todo List
- [ ] Implement SHA256 sliding window loop detector
- [ ] Implement synthetic circuit-breaker message injector
- [ ] Implement transparent 429/quota retry waterfall
- [ ] Test failover from exhausted Alibaba profile to active Kimi/Sub2API

## Success Criteria
- Simulated 3x loop halts and prompts the agent to change strategy.
- When an API key returns 429, the proxy switches to the secondary key within <500ms without throwing an error to the user.
