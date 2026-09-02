const assert = require('assert');
const { ModelRouter } = require('../core/model-router.cjs');

console.log("=== Testing Token-Stack Layer 0: Model Cascading Router ===");

const router = new ModelRouter();

// 1. Test Low Complexity Routing
const r1 = router.route("Generate git commit message for recent changes");
assert.strictEqual(r1.tier, 'cheap');
assert.strictEqual(r1.selectedModel, 'kimi-k3');
assert(r1.estimatedSavingsPercent >= 85);
console.log(`✔ Low complexity task routed to cheap tier (${r1.selectedModel}) saving ${r1.estimatedSavingsPercent}%!`);

// 2. Test High Complexity Routing
const r2 = router.route("Refactor connection pool to eliminate race condition in multi-thread environment");
assert.strictEqual(r2.tier, 'flagship');
assert.strictEqual(r2.selectedModel, 'claude-3-7-sonnet-20250219');
console.log(`✔ High complexity task routed to flagship tier (${r2.selectedModel})!`);

// 3. Test User Override
const r3 = router.route("Format this CSS button /model claude-3-opus-20240229");
assert.strictEqual(r3.tier, 'user_override');
assert.strictEqual(r3.selectedModel, 'claude-3-opus-20240229');
console.log(`✔ User override successfully respected (${r3.selectedModel})!`);

console.log("✔ ALL Phase 05 Model Router Tests PASSED successfully!\n");
