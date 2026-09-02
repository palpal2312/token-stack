# Phase 04: Zero-Token Semantic Response Cache (SQLite-VSS Vector Cache)

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Repositories: `zilliztech/GPTCache`, `Portkey-AI/gateway` (Semantic Cache)

## Overview
- **Date**: 2026-09-03
- **Description**: Implement a local zero-token semantic response cache that intercepts recurring questions, tool explanations, and lint/syntax queries, returning cached responses with zero API tokens consumed and <20ms latency.
- **Priority**: P2
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Software engineers repeatedly query similar programming topics throughout a work week (e.g. error explanations, standard library functions, documentation lookups).
- Standard prompt caching still sends data to cloud providers and incurs network latency.
- A local semantic cache powered by vector distance yields an absolute 100% token discount and instant responses.

## Requirements
1. Implement `core/semantic-cache.cjs`:
   - Maintains a lightweight SQLite vector cache at `~/.token-stack/semantic_cache.db`.
   - Embeds incoming prompts using a local ONNX model (`all-MiniLM-L6-v2`) or token n-gram Jaccard / Cosine similarity engine.
   - Evaluates similarity score:
     - If similarity ≥ 0.90:
       - Returns cached response immediately.
       - Streams response locally mimicking Anthropic SSE format (`event: content_block_delta`).
       - Increments `zero_token_savings` metric.
     - If similarity < 0.90:
       - Forwards to upstream LLM.
       - Saves new prompt-completion pair asynchronously into the cache.
2. Safety & Invalidation:
   - Never caches user messages containing credentials, tokens, or environment secrets.
   - Cache entries auto-expire after 7 days (TTL).

## Architecture
```text
[Incoming User Prompt] ──> [Semantic Cache Evaluator]
                                    │
               ┌────────────────────┴────────────────────┐
               ▼ (Similarity >= 0.90: Cache Hit)         ▼ (Similarity < 0.90: Cache Miss)
         [Return Local SSE Stream]               [Forward to Upstream LLM]
           (0 Tokens, <15ms Latency)                         │
                                                 [Store to Cache Asynchronously]
```

## Related Code Files
- `C:\Users\ADMIN\Documents\token-stack\core\semantic-cache.cjs`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`

## Implementation Steps
1. Create `core/semantic-cache.cjs` with lightweight embedding / hashing similarity logic.
2. Implement SQLite storage schema (`prompts`, `embeddings`, `responses`, `hit_count`).
3. Connect into the request pipeline ahead of Headroom.
4. Test with identical and near-identical questions; measure hit rate and latency.

## Todo List
- [ ] Create `core/semantic-cache.cjs`
- [ ] Implement SQLite schema and vector evaluator
- [ ] Implement local SSE streaming response generator
- [ ] Validate secret / credential suppression
- [ ] Test 0-token instant response behavior

## Success Criteria
- Repeated question returns identical answer in <20ms.
- 0 tokens recorded on cloud provider bills for cache hits.
