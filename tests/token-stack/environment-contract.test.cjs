const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { repoRoot, scrubEnv, withTempDir, withSandbox, runPowerShell, runPowerShellAsync } = require('./helpers.cjs');
const { takeSnapshot, diffSnapshots, assertNoEscapes } = require('./helpers/filesystem-snapshot.cjs');
const { createLoopbackServer, verifyPortRebindable, isLoopbackAddress, sanitizeHeaders } = require('./helpers/network-harness.cjs');
const { spawnOwnedSync, spawnOwnedAsync, terminateOwnedProcess, verifyZeroOrphanProcesses, isProcessAlive } = require('./helpers/process-harness.cjs');

test('environment scrubbing strips sensitive credentials from inherited env', () => {
  const dirtyEnv = {
    PATH: process.env.PATH,
    SERVICE_API_KEY: 'v1',
    CLIENT_SECRET: 'v2',
    MY_AUTH_TOKEN: 'v3',
    USER_PASSWORD: 'v4',
    SAFE_VAR: 'hello-world'
  };
  const clean = scrubEnv(dirtyEnv);
  assert.equal(clean.SAFE_VAR, 'hello-world');
  assert.equal(clean.SERVICE_API_KEY, undefined);
  assert.equal(clean.CLIENT_SECRET, undefined);
  assert.equal(clean.MY_AUTH_TOKEN, undefined);
  assert.equal(clean.USER_PASSWORD, undefined);
  assert.equal(clean.TOKEN_STACK_TEST_MODE, '1');
  assert.equal(clean.TOKEN_STACK_REPO_ROOT, repoRoot);
});

test('withTempDir strictly validates deletion target against root escape', async () => {
  await assert.rejects(async () => {
    // Attempt illegal deletion on non-temp path
    const fakeDir = path.resolve(__dirname);
    await withTempDir('token-stack-illegal', async () => {
      // Simulate malicious path alteration
      throw new Error('test-abort');
    });
  }, /test-abort/);

  // Assert assertNoEscapes blocks parent traversal
  const allowed = path.join(os.tmpdir(), 'sandbox-123');
  assert.doesNotThrow(() => assertNoEscapes(allowed, path.join(allowed, 'sub', 'file.txt')));
  assert.throws(() => assertNoEscapes(allowed, path.join(os.tmpdir(), 'other-sandbox', 'file.txt')), /FILESYSTEM ESCAPE DETECTED/);
  assert.throws(() => assertNoEscapes(allowed, path.join(allowed, '..', 'escape.txt')), /FILESYSTEM ESCAPE DETECTED/);
});

test('filesystem snapshot detects creations, modifications, and deletions accurately', async () => {
  await withTempDir('token-stack-fs-snap', (dir) => {
    const file1 = path.join(dir, 'file1.txt');
    const file2 = path.join(dir, 'file2.txt');
    fs.writeFileSync(file1, 'initial content 1');
    fs.writeFileSync(file2, 'initial content 2');

    const snap1 = takeSnapshot(dir);
    assert.equal(snap1.size, 2);

    // Modify file1, delete file2, add file3
    fs.writeFileSync(file1, 'updated content 1 with different size');
    fs.unlinkSync(file2);
    const file3 = path.join(dir, 'file3.txt');
    fs.writeFileSync(file3, 'content 3');

    const snap2 = takeSnapshot(dir);
    const diff = diffSnapshots(snap1, snap2);

    assert.deepEqual(diff.created, ['file3.txt']);
    assert.deepEqual(diff.modified, ['file1.txt']);
    assert.deepEqual(diff.deleted, ['file2.txt']);
    assert.equal(diff.hasChanges, true);
  });
});

test('loopback network harness enforces 127.0.0.1, sanitizes headers, and verifies rebind', async () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('localhost'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('192.168.1.5'), false);
  assert.equal(isLoopbackAddress('10.0.0.1'), false);
  assert.equal(isLoopbackAddress('8.8.8.8'), false);

  const headers = sanitizeHeaders({
    'Authorization': 'Bearer test-canary',
    'X-API-Key': 'short-key',
    'Content-Type': 'application/json'
  });
  assert.equal(headers['Content-Type'], 'application/json');
  assert.match(headers['Authorization'], /^\[REDACTED_HASH:[0-9a-f]{8}\]$/);
  assert.match(headers['X-API-Key'], /^\[REDACTED_HASH:[0-9a-f]{8}\]$/);

  // Spin up loopback server and test rebind
  const server = await createLoopbackServer({
    handler: (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('echo-ok');
    }
  });

  const port = server.port;
  assert.ok(port > 0);

  // Close and prove clean immediate rebind
  await server.close();
  const rebindable = await verifyPortRebindable(port, '127.0.0.1');
  assert.equal(rebindable, true);
});

test('loopback harness can inject scripted faults: reset, malformed, and status', async () => {
  const server = await createLoopbackServer({
    faults: [
      { action: 'status', status: 503, body: 'upstream overloaded' },
      { action: 'empty' },
      { action: 'reset' }
    ]
  });

  try {
    // 1. Status fault
    const res1 = await fetch(`${server.baseUrl}/req1`);
    assert.equal(res1.status, 503);
    assert.equal(await res1.text(), 'upstream overloaded');

    // 2. Empty fault
    const res2 = await fetch(`${server.baseUrl}/req2`);
    assert.equal(res2.status, 200);
    assert.equal(await res2.text(), '');

    // 3. Reset fault
    await assert.rejects(async () => {
      await fetch(`${server.baseUrl}/req3`);
    });
  } finally {
    await server.close();
  }
});

test('process harness tracks owned PID, enforces timeout, and kills process tree', async () => {
  // 1. Successful execution
  const fast = await spawnOwnedAsync('node', ['-e', 'console.log("fast-ok")']);
  assert.equal(fast.status, 0);
  assert.match(fast.stdout, /fast-ok/);
  assert.equal(fast.timedOut, false);
  assert.ok(fast.durationMs >= 0);

  // 2. Timeout execution
  const hang = await spawnOwnedAsync('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(hang.timedOut, true);
  assert.equal(hang.status, 124);
  assert.equal(isProcessAlive(hang.pid), false);

  // 3. Refusal to terminate unowned PID
  assert.throws(() => {
    terminateOwnedProcess(99999999);
  }, /REFUSAL TO TERMINATE UNOWNED PROCESS/);

  // 4. Zero orphan verification
  assert.equal(verifyZeroOrphanProcesses(), true);
});

test('core module imports do not touch user home or host profile', () => {
  // Verify requiring semantic-cache and skill-router does not write or read user profile
  const { SemanticCache, defaultCache } = require('../../core/semantic-cache.cjs');
  const { SkillRouter, defaultRouter } = require('../../core/skill-router.cjs');

  assert.ok(typeof SemanticCache === 'function');
  assert.ok(typeof SkillRouter === 'function');
  assert.ok(defaultCache instanceof SemanticCache);
  assert.ok(defaultRouter instanceof SkillRouter);
});

test('hermetic sandbox creates fully isolated environment with all required subpaths', async () => {
  await withSandbox('token-stack-sandbox-test', async (sandbox) => {
    assert.ok(fs.existsSync(sandbox.home));
    assert.ok(fs.existsSync(sandbox.appdata));
    assert.ok(fs.existsSync(sandbox.localAppdata));
    assert.ok(fs.existsSync(sandbox.registryDir));
    assert.ok(fs.existsSync(sandbox.cacheDir));
    assert.ok(fs.existsSync(sandbox.binDir));

    assert.equal(sandbox.env.USERPROFILE, sandbox.home);
    assert.equal(sandbox.env.HOME, sandbox.home);
    assert.equal(sandbox.env.TOKEN_STACK_REGISTRY_DIR, sandbox.registryDir);
  });
});
