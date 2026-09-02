const assert = require('assert');
const path = require('path');
const { SemanticCache } = require('../core/semantic-cache.cjs');

console.log("=== Testing Token-Stack Layer -1: Zero-Token Semantic Cache ===");

const testDbPath = path.join(__dirname, 'test-cache.json');
const cache = new SemanticCache({ dbPath: testDbPath, threshold: 0.88 });
cache.clear();

// 1. Store a known programming explanation
const p1 = "What does HTTP status code 429 mean in REST API?";
const r1 = "HTTP 429 Too Many Requests indicates the user has sent too many requests in a given amount of time (rate limited).";
cache.store(p1, r1, "claude-3-7-sonnet");

// 2. Test Exact Match Hit
const t0 = Date.now();
const hit1 = cache.find(p1);
const duration = Date.now() - t0;
assert(hit1 !== null, "Exact match must be a cache HIT");
assert.strictEqual(hit1.similarity, 1.0);
assert.strictEqual(hit1.response, r1);
console.log(`✔ Exact match HIT in ${duration}ms with 0 tokens!`);

// 3. Test Paraphrased Semantic Match Hit
const p2 = "What does HTTP status 429 mean in a REST API call?";
const hit2 = cache.find(p2);
assert(hit2 !== null, "Paraphrased question must be a cache HIT");
assert(hit2.similarity >= 0.88, `Similarity ${hit2.similarity} must be >= 0.88`);
assert.strictEqual(hit2.response, r1);
console.log(`✔ Paraphrased match HIT (similarity: ${hit2.similarity}) with 0 tokens!`);

// 4. Test Unrelated Query Miss
const p3 = "How do I reverse a linked list in C++?";
const miss = cache.find(p3);
assert.strictEqual(miss, null, "Unrelated query must be a cache MISS");
console.log("✔ Unrelated query correctly reported MISS!");

// 5. Test Secret Filter
const secretPrompt = "My secret token is sk-1234567890abcdef1234567890abcdef. Format this.";
cache.store(secretPrompt, "ok");
assert.strictEqual(cache.find(secretPrompt), null, "Prompts containing API secrets must never be cached!");
console.log("✔ Secret filter successfully prevented caching of credentials!");

// Cleanup
try {
  require('fs').unlinkSync(testDbPath);
} catch (e) {}

console.log("✔ ALL Phase 04 Semantic Cache Tests PASSED successfully!\n");
