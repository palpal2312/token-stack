const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShell, withSandbox } = require('./helpers.cjs');
const { takeSnapshot, diffSnapshots } = require('./helpers/filesystem-snapshot.cjs');

const installerScript = path.join(repoRoot, 'scripts', 'install-token-stack.ps1');

test('Installer: dry-run performs zero file changes in target profile', () => withSandbox('installer-dry', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'dry-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ env: {} }));

  const snapBefore = takeSnapshot(sandbox.root);

  const res = runPowerShell([
    '-File', installerScript,
    '-ProfileDirectory', profileDir,
    '-SourceRoot', repoRoot
  ], { env: sandbox.env });

  assert.equal(res.status, 0, res.stderr);

  const snapAfter = takeSnapshot(sandbox.root);
  const diff = diffSnapshots(snapBefore, snapAfter);
  assert.equal(diff.hasChanges, false, `Dry-run modified filesystem: ${JSON.stringify(diff)}`);
}));

test('Installer: apply mode installs skills, injects plugins, and is idempotent', () => withSandbox('installer-apply', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'apply-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ env: {} }));

  const args = [
    '-File', installerScript,
    '-ProfileDirectory', profileDir,
    '-SourceRoot', repoRoot,
    '-Apply'
  ];

  // First apply
  const r1 = runPowerShell(args, { env: sandbox.env, timeoutMs: 90000 });
  assert.equal(r1.status, 0, r1.stderr);

  // Assert skills directory and settings updated
  const skillsDir = path.join(profileDir, 'skills');
  assert.ok(fs.existsSync(skillsDir), 'skills directory was not created');
  assert.ok(fs.existsSync(path.join(skillsDir, 'token-stack')));

  const settings = JSON.parse(fs.readFileSync(path.join(profileDir, 'settings.json'), 'utf8'));
  assert.ok(settings.enabledPlugins['caveman@caveman']);
  assert.ok(settings.enabledPlugins['ponytail@ponytail']);

  // Second apply (Idempotency)
  const r2 = runPowerShell(args, { env: sandbox.env, timeoutMs: 90000 });
  assert.equal(r2.status, 0, r2.stderr);

  const settings2 = JSON.parse(fs.readFileSync(path.join(profileDir, 'settings.json'), 'utf8'));
  assert.deepEqual(settings, settings2);
}));

test('Installer: non-existent SourceRoot throws clean error and exits non-zero', () => withSandbox('installer-bad-root', (sandbox) => {
  const profileDir = path.join(sandbox.root, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const res = runPowerShell([
    '-File', installerScript,
    '-ProfileDirectory', profileDir,
    '-SourceRoot', path.join(sandbox.root, 'non-existent-source')
  ], { env: sandbox.env });

  assert.notEqual(res.status, 0);
}));
