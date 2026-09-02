# Phase 02: Runaway Loop Breaker & Smart Waterfall Failover

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Frameworks: `guardrails-ai/guardrails`, `NVIDIA/NeMo-Guardrails`, `BerriAI/litellm`

## Overview
- **Date**: 2026-09-03
- **Description**: Implement an active runtime circuit breaker that prevents infinite tool calling loops and provides transparent waterfall failover when a cloud provider returns 429 rate limit or quota exhaustion.
- **Priority**: P1
- **Implementation Status**: completed
- **Review Status**: verified

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

## Architecture & Transparent Waterfall State Machine
```text
[Incoming Request] ──> [Tool Hash Ring Tracker (Window: 6)]
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼ (Consecutive Duplicate Hash Count >= 3)       ▼ (Duplicate Count < 3)
[Inject Circuit Breaker Warning & Halt Loop]       [Forward Request to Primary Provider]
                                                                  │
                                            ┌─────────────────────┴─────────────────────┐
                                            ▼ (HTTP 429 / 503 / Quota Error)            ▼ (HTTP 200 OK)
                                   [Transparent Waterfall Retry Engine (<500ms)]  [Pipe SSE Stream to Client]
                                   1. Extract next profile from registry tier
                                   2. Re-sign auth header (x-api-key / Bearer)
                                   3. Resend in-flight request seamlessly!
```

### 1. Loop Detector Algorithm
- Compute `hash = crypto.createHash('sha256').update(tool.name + JSON.stringify(tool.input)).digest('hex')`.
- Maintain `ringBuffer = Array(6)`.
- If `ringBuffer.slice(-3).every(h => h === hash)`:
  - Intercept execution.
  - Return synthetic assistant message:
    `[CIRCUIT BREAKER: Action '${tool.name}' has been executed 3 consecutive times with identical inputs and no progress. Execution halted to prevent runaway token spend. Inspect error outputs, read surrounding files, or formulate an alternate hypothesis.]`

### 2. Transparent Waterfall Failover Algorithm
- Provider tiers defined in `token-stack.registry.json`:
  ```json
  "waterfall_tiers": ["kimicode", "sub2api-01", "sub2api-02"]
  ```
- When upstream responds with HTTP status `429` (Rate limit or `Throttling.AllocationQuota`) or `503` (No available accounts):
  - Do NOT pass error back to client.
  - Log: `[Failover] Primary provider returned 429. Replaying request to tier fallback: ${nextProvider}...`.
  - Fetch target provider port & upstream from registry.
  - Swap auth headers with next provider's key.
  - Re-issue request to fallback port within 500ms.
  - Client receives valid streaming tokens with zero perception of provider failure.

## Concrete Test Cases
- **Test 1 (Loop Detection)**: Feed 3 identical tool calls (`read_file { path: 'nonexistent.ts' }`). The 3rd execution triggers the synthetic intervention warning.
- **Test 2 (Simulated 429 Failover)**: Mock primary provider returning HTTP 429 `Throttling.AllocationQuota`. Proxy automatically routes to secondary provider and returns HTTP 200 with complete stream.
- **Test 3 (All Tiers Exhausted)**: If all tiers fail, returns detailed diagnostic summary with reset timestamps.

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
