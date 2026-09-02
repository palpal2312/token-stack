const assert = require('assert');
const { evaluateThinkingBudget, modulateThinkingPayload } = require('../core/cot-governor.cjs');

console.log("=== Testing Token-Stack Layer 6: CoT Budget Governor ===");

// 1. Test low complexity
assert.strictEqual(evaluateThinkingBudget("Fix typo in button label"), 1024);
assert.strictEqual(evaluateThinkingBudget("Write git commit message"), 1024);
assert.strictEqual(evaluateThinkingBudget("Format README.md docstring"), 1024);

// 2. Test medium complexity
assert.strictEqual(evaluateThinkingBudget("Implement user profile validation endpoint"), 4096);

// 3. Test high complexity
assert.strictEqual(evaluateThinkingBudget("Architect a distributed lock with race condition avoidance"), 8192);
assert.strictEqual(evaluateThinkingBudget("Refactor auth middleware to eliminate memory leak"), 8192);

// 4. Test user override
assert.strictEqual(evaluateThinkingBudget("Quick fix <!-- budget: 12000 -->"), 12000);

// 5. Test payload modulation
const payload = {
  model: "claude-3-7-sonnet-20250219",
  thinking: { type: "enabled", budget_tokens: 8000 },
  max_tokens: 10000,
  messages: [
    { role: "user", content: "Format this CSS button style" }
  ]
};

const res = modulateThinkingPayload(payload);
assert.strictEqual(res.modulated, true);
assert.strictEqual(res.assignedBudget, 1024, "Trivial CSS task must be throttled to 1024 thinking tokens");
assert.strictEqual(payload.thinking.budget_tokens, 1024);
assert(payload.max_tokens >= 5120, "max_tokens must accommodate budget_tokens");

console.log("✔ CoT Budget Governor successfully throttled simple task from 8000 to 1024 tokens!");
console.log("✔ ALL Phase 03 CoT Governor Tests PASSED successfully!\n");
