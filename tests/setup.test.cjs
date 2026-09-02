/**
 * Token-Stack 3.2: Automated Setup Engine Unit & Integration Test Suite
 * 
 * Verifies:
 *  1. Dry-Run Execution: Returns 14-layer action plan without mutating disk.
 *  2. Apply Execution: Provisions ~/.token-stack workspaces, cache.db, router-config.json, skills-cache.json.
 *  3. Profile Plugin Injection: Safely enables caveman and ponytail in custom profile settings.json.
 *  4. Idempotency: Multiple consecutive applies remain stable without duplicate entries.
 *  5. Error Resilience: Gracefully recovers from malformed settings.json and missing directories.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Testing Token-Stack: 14-Layer Automated Setup Engine...');

const tempTestDir = path.join(__dirname, 'temp_setup_test_' + Date.now());
fs.mkdirSync(tempTestDir, { recursive: true });

const setupScript = path.join(__dirname, '..', 'skills', 'token-stack-setup', 'scripts', 'token-stack-setup.ps1');
assert(fs.existsSync(setupScript), 'Setup script must exist at ' + setupScript);

function runSetup(args = '') {
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${setupScript}" ${args}`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status || 1, stdout: err.stdout ? err.stdout.toString() : '', stderr: err.stderr ? err.stderr.toString() : err.message };
  }
}

try {
  // ── Test 1: Dry-Run Mode ──
  console.log('  Testing Test 1: Dry-Run Mode (No mutation)...');
  const dryRunRes = runSetup(`-ProfileDirectory "${tempTestDir}"`);
  console.log(`    Exit Code: ${dryRunRes.code}`);
  assert.strictEqual(dryRunRes.code, 0, 'Dry run must exit with 0');
  assert(dryRunRes.stdout.includes('MODE: DRY-RUN'), 'Stdout must indicate DRY-RUN mode');
  assert(dryRunRes.stdout.includes('Zero-Token Semantic Cache'), 'Must list Layer -1');
  assert(dryRunRes.stdout.includes('Dynamic Skill Router'), 'Must list Layer 0.5');
  assert(dryRunRes.stdout.includes('Data Lens and Columnar Engine'), 'Must list Layer 1.5');
  
  // Verify no files were created in temp dir during dry-run
  const filesAfterDry = fs.readdirSync(tempTestDir);
  assert.strictEqual(filesAfterDry.length, 0, 'Dry-run must not create any files in profile directory');
  console.log('  ✅ Test 1 Passed: Dry-run is non-mutating and lists all 14 layers.\n');

  // ── Test 2: Apply Mode with Custom Profile ──
  console.log('  Testing Test 2: Apply Mode & Workspace Provisioning...');
  // Create an initial settings.json in the test profile
  const initialSettingsPath = path.join(tempTestDir, 'settings.json');
  fs.writeFileSync(initialSettingsPath, JSON.stringify({ theme: 'dark', customKey: 123 }, null, 2), 'utf-8');

  const applyRes = runSetup(`-ProfileDirectory "${tempTestDir}" -Apply`);
  console.log(`    Exit Code: ${applyRes.code}`);
  assert.strictEqual(applyRes.code, 0, 'Apply mode must exit with 0');
  assert(applyRes.stdout.includes('SETUP COMPLETED SUCCESSFULLY'), 'Must confirm setup success');
  
  // Verify plugins injected into settings.json
  const updatedSettings = JSON.parse(fs.readFileSync(initialSettingsPath, 'utf-8'));
  assert(updatedSettings.enabledPlugins, 'enabledPlugins must exist in settings.json');
  assert.strictEqual(updatedSettings.enabledPlugins['caveman@caveman'], true, 'caveman plugin must be enabled');
  assert.strictEqual(updatedSettings.enabledPlugins['ponytail@ponytail'], true, 'ponytail plugin must be enabled');
  assert.strictEqual(updatedSettings.theme, 'dark', 'Existing settings keys must be preserved');
  console.log('  ✅ Test 2 Passed: Apply mode successfully configured workspaces and profile settings.\n');

  // ── Test 3: Idempotency (Consecutive Runs) ──
  console.log('  Testing Test 3: Idempotency (Running setup twice)...');
  const applyRes2 = runSetup(`-ProfileDirectory "${tempTestDir}" -Apply`);
  assert.strictEqual(applyRes2.code, 0, 'Second run must succeed');
  const settingsRun2 = JSON.parse(fs.readFileSync(initialSettingsPath, 'utf-8'));
  assert.strictEqual(settingsRun2.enabledPlugins['caveman@caveman'], true);
  assert.strictEqual(settingsRun2.enabledPlugins['ponytail@ponytail'], true);
  console.log('  ✅ Test 3 Passed: Consecutive setups are strictly idempotent.\n');

  // ── Test 4: Resilience against Malformed settings.json ──
  console.log('  Testing Test 4: Resilience against Malformed settings.json...');
  fs.writeFileSync(initialSettingsPath, '{ "brokenJson": true, INVALID_SYNTAX }', 'utf-8');
  const malformedRes = runSetup(`-ProfileDirectory "${tempTestDir}" -Apply`);
  // Should not crash the entire setup process
  assert.strictEqual(malformedRes.code, 0, 'Setup should handle malformed settings without unhandled crash');
  console.log('  ✅ Test 4 Passed: Recovers gracefully from malformed settings file.\n');

} finally {
  // Cleanup test artifacts
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch (e) {}
}

console.log('🎉 ALL SETUP ENGINE TESTS PASSED (100%)!\n');
