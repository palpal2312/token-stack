const assert = require('assert');
const { GuardrailEngine } = require('../core/guardrail.cjs');

console.log("=== Testing Token-Stack Layer 8: Loop Breaker & Waterfall Failover ===");

const guard = new GuardrailEngine({ maxConsecutiveLoops: 3 });

// 1. Test Normal distinct actions
assert.strictEqual(guard.evaluateToolCall('view_file', { path: 'a.js' }).isLoop, false);
assert.strictEqual(guard.evaluateToolCall('view_file', { path: 'b.js' }).isLoop, false);
assert.strictEqual(guard.evaluateToolCall('replace_file_content', { path: 'a.js' }).isLoop, false);

// 2. Test Repetitive Loop Interception
assert.strictEqual(guard.evaluateToolCall('run_command', { cmd: 'npm test' }).isLoop, false); // 1st
assert.strictEqual(guard.evaluateToolCall('run_command', { cmd: 'npm test' }).isLoop, false); // 2nd
const loopResult = guard.evaluateToolCall('run_command', { cmd: 'npm test' }); // 3rd (MUST TRIGGER LOOP BREAKER!)
assert.strictEqual(loopResult.isLoop, true, "3rd consecutive identical action must trigger loop breaker");
assert(loopResult.intervention.includes('CIRCUIT BREAKER: Action \'run_command\''), "Intervention message must be provided");
console.log("✔ Loop breaker intercepted 3x identical tool call successfully!");

// 3. Test Budget Tracking
guard.reset();
const usage1 = guard.trackUsage(10000, 5000);
assert.strictEqual(usage1.warning, false);
const usage2 = guard.trackUsage(30000, 10000); // 55k total
assert.strictEqual(usage2.warning, true, "Should trigger warning at >50k tokens");
assert.strictEqual(usage2.hardCapped, false);
console.log("✔ Budget tracking warning verified!");

// 4. Test Transparent Waterfall Failover
async function testWaterfall() {
  const tiers = [
    { name: 'alibaba-01', status: 429 }, // Fails with 429 quota
    { name: 'sub2api-01', status: 200, data: 'stream_success' }  // Succeeds!
  ];

  let attempts = 0;
  const mockDispatch = async (provider) => {
    attempts++;
    if (provider.status === 429) {
      return { status: 429, statusText: 'Throttling.AllocationQuota' };
    }
    return { status: 200, body: provider.data };
  };

  const finalResp = await guard.executeWaterfall(mockDispatch, tiers);
  assert.strictEqual(finalResp.status, 200, "Waterfall must return 200 from secondary tier");
  assert.strictEqual(finalResp.body, 'stream_success');
  assert.strictEqual(attempts, 2, "Must attempt primary then secondary provider");
  console.log("✔ Transparent Waterfall Failover successfully recovered from 429!");
}

testWaterfall().then(() => {
  console.log("✔ ALL Phase 02 Guardrail Tests PASSED successfully!\n");
});
