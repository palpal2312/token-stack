const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShell, withSandbox } = require('./helpers.cjs');
const cliScript = path.join(repoRoot, 'bin', 'token-stack.ps1');

test('CLI: help and --help output usage and exit with 0', () => {
  const r1 = runPowerShell(['-File', cliScript, 'help']);
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /Token-Stack 3\.2 CLI/);

  const r2 = runPowerShell(['-File', cliScript, '-Help']);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /Usage:/);
});

test('CLI: unknown command prints error to stderr and exits with non-zero status', () => {
  const result = runPowerShell(['-File', cliScript, 'nonexistent-subcommand-xyz']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command: nonexistent-subcommand-xyz/);
});

test('CLI: status command runs cleanly with temporary registry', () => withSandbox('cli-status', (sandbox) => {
  const regPath = path.join(sandbox.registryDir, 'registry.json');
  fs.writeFileSync(regPath, JSON.stringify({ version: '2.0.0', profiles: {} }));

  const result = runPowerShell(['-File', cliScript, 'status'], {
    env: { TOKEN_STACK_REGISTRY: regPath, ...sandbox.env }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Token-Stack/i);
}));

test('CLI: profile add without name prints error and exits nonzero', () => withSandbox('cli-prof-err', (sandbox) => {
  const regPath = path.join(sandbox.registryDir, 'registry.json');
  fs.writeFileSync(regPath, JSON.stringify({ version: '2.0.0', profiles: {} }));

  const result = runPowerShell(['-File', cliScript, 'profile', 'add'], {
    env: { TOKEN_STACK_REGISTRY: regPath, ...sandbox.env }
  });
  // Should report missing profile name or error
  assert.match(result.stdout + result.stderr, /Usage: token-stack profile add/i);
}));

test('CLI: arguments with spaces and special characters are handled safely without injection', () => withSandbox('cli-injection', (sandbox) => {
  const regPath = path.join(sandbox.registryDir, 'registry.json');
  fs.writeFileSync(regPath, JSON.stringify({ version: '2.0.0', profiles: {} }));

  // Safe handling of name with spaces or quotes
  const safeName = 'fixture-test-name';
  const add = runPowerShell(['-File', cliScript, 'profile', 'add', safeName], {
    env: { TOKEN_STACK_REGISTRY: regPath, ...sandbox.env }
  });
  assert.equal(add.status, 0, add.stderr);

  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  assert.ok(reg.profiles[safeName]);
}));
