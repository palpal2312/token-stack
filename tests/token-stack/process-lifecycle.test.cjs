const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const { repoRoot } = require('./helpers.cjs');
const { spawnOwnedProcess, spawnOwnedAsync, isProcessAlive, terminateOwnedProcess, verifyZeroOrphanProcesses } = require('./helpers/process-harness.cjs');
const { verifyPortRebindable } = require('./helpers/network-harness.cjs');

const fakeHeadroomScript = path.join(repoRoot, 'tests', 'token-stack', 'fixtures', 'fake-headroom.ps1');

test('Lifecycle: fake-headroom starts, reports readiness, and terminates cleanly', async () => {
  let detectedPort = null;
  const { pid, promise } = spawnOwnedProcess('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', fakeHeadroomScript,
    '-Port', '0',
    '-Mode', 'ready'
  ], {
    timeoutMs: 15000,
    onStdout: (text) => {
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) detectedPort = parseInt(match[1], 10);
    }
  });

  try {
    // Poll /readyz until ready
    let ready = false;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (detectedPort) {
        try {
          const res = await new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${detectedPort}/readyz`, resolve);
            req.on('error', reject);
          });
          if (res.statusCode === 200) {
            ready = true;
            break;
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, 100));
    }

    assert.equal(ready, true, 'Proxy failed to report ready status');
    assert.ok(isProcessAlive(pid));
  } finally {
    const { treeKill } = require('./helpers/process-harness.cjs');
    treeKill(pid);
  }

  const result = await promise;
  assert.ok(result.durationMs >= 0);

  // Verify port is rebindable
  const rebindable = await verifyPortRebindable(detectedPort, '127.0.0.1');
  assert.equal(rebindable, true);
  assert.equal(verifyZeroOrphanProcesses(), true);
});

test('Lifecycle: early proxy crash exits with non-zero and leaves zero orphans', async () => {
  const result = await spawnOwnedAsync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', fakeHeadroomScript,
    '-Mode', 'crash'
  ]);

  assert.equal(result.status, 42);
  assert.equal(result.timedOut, false);
  assert.equal(verifyZeroOrphanProcesses(), true);
});

test('Lifecycle: hanging process hits deadline, is tree-killed, and exits with 124', async () => {
  const result = await spawnOwnedAsync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', fakeHeadroomScript,
    '-Mode', 'hang'
  ], { timeoutMs: 800 });

  assert.equal(result.timedOut, true);
  assert.equal(result.status, 124);
  assert.equal(verifyZeroOrphanProcesses(), true);
});

test('Lifecycle: refusal to terminate foreign process PID', () => {
  assert.throws(() => {
    terminateOwnedProcess(88888888);
  }, /REFUSAL TO TERMINATE UNOWNED PROCESS/);
});
