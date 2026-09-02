# Phase 04: Zero-Token Semantic Response Cache (SQLite-VSS Vector Cache)

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Repositories: `zilliztech/GPTCache`, `Portkey-AI/gateway` (Semantic Cache)

## Overview
- **Date**: 2026-09-03
- **Description**: Implement a local zero-token semantic response cache that intercepts recurring questions, tool explanations, and lint/syntax queries, returning cached responses with zero API tokens consumed and <20ms latency.
- **Priority**: P2
- **Implementation Status**: completed
- **Review Status**: verified

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

## Architecture & Zero-Dependency Vector Similarity Math
```text
[User Prompt] ──> [Word & Character 3-Gram Tokenizer] ──> [Vector Hash Frequency]
                                                                  │
                ┌─────────────────────────────────────────────────┴─────────────────────────────────┐
                ▼ (Evaluate Cosine Similarity against SQLite Cache)                                  ▼ (No match > 0.88)
         [Similarity >= 0.88]                                                                 [Forward to LLM API]
                  │                                                                                    │
         [Stream Instant SSE (<15ms)]                                                          [Save to Cache DB]
         - Return 0-token synthetic stream                                                     - Store for future hits
```

### N-Gram Cosine Similarity Algorithm (Pure Node.js, Zero Dependencies)
1. **N-Gram Generation**:
   - Tokenize prompt into normalized word tokens + char 3-grams.
   - Example: `"explain TS2307 error"` -> `['explain', 'ts2307', 'error', 'exp', 'xpl', 'pla', 'lai', 'ain', 'ts2', 's23', '230', '307', 'err', 'rro', 'ror']`.
2. **Cosine Vector Dot Product**:
   - Compute frequency vector: $V(w) = \text{count}(w)$.
   - Similarity: $\text{Cosine}(A, B) = \frac{A \cdot B}{\|A\| \|B\|} = \frac{\sum A_i B_i}{\sqrt{\sum A_i^2} \sqrt{\sum B_i^2}}$.
3. **SQLite Schema (`~/.token-stack/semantic_cache.db`)**:
   ```sql
   CREATE TABLE IF NOT EXISTS semantic_cache (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     prompt_hash TEXT UNIQUE,
     raw_prompt TEXT,
     tokens_json TEXT,
     response_sse TEXT,
     hit_count INTEGER DEFAULT 0,
     created_at INTEGER,
     expires_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS idx_prompt_hash ON semantic_cache(prompt_hash);
   ```
4. **Safety Filter**:
   - Skip caching if prompt contains sensitive keywords: `sk-`, `password`, `secret`, `bearer`, `token`, `credential`.

## Concrete Test Cases
- **Test 1 (Exact Match Hit)**: Querying "What does HTTP status 429 mean?" a second time returns cached answer in <10ms with 0 API tokens.
- **Test 2 (Near-Semantic Match Hit)**: Querying "What is HTTP status code 429?" achieves similarity >0.91, returning the cached explanation without calling cloud API.
- **Test 3 (Secret Protection)**: Prompts containing `sk-kimi-...` are rejected from caching.

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
