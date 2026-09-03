const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { scrubEnv, cleanupAllProcesses, cleanupAllServers } = require('./helpers.cjs');

const testFiles = [
  'environment-contract.test.cjs',
  'core.test.cjs',
  'core-properties.test.cjs',
  'core-fuzz-regressions.test.cjs',
  'powershell-cli.test.cjs',
  'registry-port.test.cjs',
  'setup-install.test.cjs',
  'process-lifecycle.test.cjs',
  'verifier-chaos.test.cjs',
  'redaction.test.cjs',
  'installer.test.cjs',
  'packaging.test.cjs',
  'compatibility.test.cjs',
  'soak-stress.test.cjs',
  'benchmarks.test.cjs',
  'integration.test.cjs'
].map((file) => path.join(__dirname, file));

const root = path.resolve(__dirname, '..', '..');
const cleanEnv = scrubEnv(process.env, { TOKEN_STACK_TEST_MODE: '1' });

const secretScan = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-token-stack-secrets.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: cleanEnv
});
if (secretScan.status !== 0) {
  cleanupAllProcesses();
  cleanupAllServers();
  process.exit(secretScan.status ?? 1);
}

const result = spawnSync(process.execPath, [...process.execArgv, '--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
  env: cleanEnv
});

cleanupAllProcesses();
cleanupAllServers();
process.exit(result.status ?? 1);
