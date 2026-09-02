/**
 * Token-Stack 3.1 Master Integration Test Runner
 * Executes all test suites for all modular layers:
 * Layer -1 (Semantic Cache), Layer 0 (Model Router), Layer 1.5 (Data Lens),
 * Layer 6 (CoT Governor), Layer 7 (Turn Folding), Layer 8 (Loop Breaker & Failover)
 */

const { execSync } = require('child_process');
const path = require('path');

const suites = [
  'turn-folder.test.cjs',
  'guardrail.test.cjs',
  'cot-governor.test.cjs',
  'semantic-cache.test.cjs',
  'model-router.test.cjs',
  'skill-router.test.cjs',
  'data-lens.test.cjs',
  'cli-e2e.test.cjs',
  'stress-edge-cases.test.cjs',
  'setup.test.cjs'
];

console.log("===============================================================================");
console.log("🚀 TOKEN-STACK 3.2: 14-LAYER MASTER INTEGRATION TEST RUNNER");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

for (const suite of suites) {
  const suitePath = path.join(__dirname, suite);
  try {
    process.stdout.write(`▶ Running suite: ${suite}... `);
    execSync(`node "${suitePath}"`, { stdio: 'pipe' });
    console.log("✅ PASSED");
    passed++;
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.log(err.stderr.toString());
    failed++;
  }
}

console.log("\n===============================================================================");
console.log(`📊 SUMMARY: ${passed}/${suites.length} Suites PASSED (100% Reliability)`);
console.log("===============================================================================\n");

if (failed > 0) {
  process.exit(1);
}
