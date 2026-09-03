const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShell, withSandbox } = require('./helpers.cjs');
const { takeSnapshot, diffSnapshots } = require('./helpers/filesystem-snapshot.cjs');

const setupScript = path.join(repoRoot, 'skills', 'token-stack-setup', 'scripts', 'token-stack-setup.ps1');

test('Setup: dry-run performs zero writes to profile and home directories', () => withSandbox('setup-dryrun', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'dry-profile');
  const homeDir = path.join(sandbox.root, 'dry-home');
  const binDir = path.join(sandbox.root, 'dry-bin');

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  const snapBefore = takeSnapshot(sandbox.root);

  // Execute without -Apply (Dry-Run mode)
  const result = runPowerShell([
    '-File', setupScript,
    '-ProfileDirectory', profileDir,
    '-TokenStackHome', homeDir,
    '-GlobalBinDirectory', binDir,
    '-Offline'
  ], { env: sandbox.env });

  assert.equal(result.status, 0, result.stderr);

  const snapAfter = takeSnapshot(sandbox.root);
  const diff = diffSnapshots(snapBefore, snapAfter);

  // Dry-run must make zero file creations or modifications
  assert.equal(diff.hasChanges, false, `Dry-run modified files: ${JSON.stringify(diff)}`);
}));

test('Setup: apply mode creates required configuration files and is idempotent', () => withSandbox('setup-apply', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'target-profile');
  const homeDir = path.join(sandbox.root, 'target-home');
  const binDir = path.join(sandbox.root, 'target-bin');

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ theme: 'dark' }), 'utf8');

  const args = [
    '-File', setupScript,
    '-ProfileDirectory', profileDir,
    '-TokenStackHome', homeDir,
    '-GlobalBinDirectory', binDir,
    '-Offline',
    '-Apply'
  ];

  // First apply
  const r1 = runPowerShell(args, { env: sandbox.env });
  assert.equal(r1.status, 0, r1.stderr);

  assert.ok(fs.existsSync(path.join(profileDir, 'settings.json')));
  assert.ok(fs.existsSync(path.join(homeDir, 'router-config.json')));
  assert.ok(fs.existsSync(path.join(binDir, 'token-stack.cmd')));

  const snapFirst = takeSnapshot(sandbox.root);

  // Second apply (Idempotence check)
  const r2 = runPowerShell(args, { env: sandbox.env });
  assert.equal(r2.status, 0, r2.stderr);

  const snapSecond = takeSnapshot(sandbox.root);
  const diff = diffSnapshots(snapFirst, snapSecond);

  // Re-running apply must not create or delete files
  assert.equal(diff.created.length, 0);
  assert.equal(diff.deleted.length, 0);
}));

test('Setup: corrupt settings.json triggers safe backup and regenerates valid config', () => withSandbox('setup-backup', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'corrupt-profile');
  const homeDir = path.join(sandbox.root, 'corrupt-home');
  const binDir = path.join(sandbox.root, 'corrupt-bin');

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'settings.json'), '{corrupt-json-data-here!!!', 'utf8');

  const args = [
    '-File', setupScript,
    '-ProfileDirectory', profileDir,
    '-TokenStackHome', homeDir,
    '-GlobalBinDirectory', binDir,
    '-Offline',
    '-Apply'
  ];

  const result = runPowerShell(args, { env: sandbox.env });
  assert.equal(result.status, 0, result.stderr);

  // Verify backup file exists
  const files = fs.readdirSync(profileDir);
  const backup = files.find(f => f.includes('.corrupted.') && f.endsWith('.bak'));
  assert.ok(backup, 'Backup file was not created');

  // Verify restored settings.json is valid JSON
  const settings = JSON.parse(fs.readFileSync(path.join(profileDir, 'settings.json'), 'utf8'));
  assert.ok(settings.enabledPlugins);
}));
