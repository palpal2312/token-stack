const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShellAsync, withTempDir } = require('./helpers.cjs');
const { createFakeAnthropicServer } = require('./helpers/fake-anthropic-server.cjs');

const verifierScript = path.join(repoRoot, 'core', 'verifier.ps1');

test('Verifier Chaos: valid 200 + complete SSE yields RESULT: PASS', async () => {
  const server = await createFakeAnthropicServer({ scenario: 'ready-pass' });
  try {
    await withTempDir('verifier-pass', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          test: {
            headroom_port: server.port,
            upstream: server.baseUrl,
            model: 'claude-sonnet-4-5-thinking'
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'test',
        '-RegistryPath', regPath,
        '-ApiKey', 'synthetic-test-key-ok',
        '-AllowLive'
      ]);

      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /RESULT: PASS/);
    });
  } finally {
    await server.close();
  }
});

test('Verifier Chaos: upstream 429 quota exhaustion yields typed FAIL and exit code 1', async () => {
  const server = await createFakeAnthropicServer({ scenario: 'upstream-429' });
  try {
    await withTempDir('verifier-429', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          test: {
            headroom_port: server.port,
            upstream: server.baseUrl
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'test',
        '-RegistryPath', regPath,
        '-ApiKey', 'synthetic-test-key',
        '-AllowLive'
      ]);

      assert.equal(res.status, 1);
      assert.match(res.stdout, /Quota Exhausted/i);
      assert.match(res.stdout, /RESULT: FAIL/);
    });
  } finally {
    await server.close();
  }
});

test('Verifier Chaos: upstream 400 model rejection yields typed FAIL', async () => {
  const server = await createFakeAnthropicServer({ scenario: 'upstream-400' });
  try {
    await withTempDir('verifier-400', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          test: {
            headroom_port: server.port,
            upstream: server.baseUrl,
            model: 'bad-model-name'
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'test',
        '-RegistryPath', regPath,
        '-ApiKey', 'synthetic-test-key',
        '-AllowLive'
      ]);

      assert.equal(res.status, 1);
      assert.match(res.stdout, /rejected by upstream/i);
      assert.match(res.stdout, /RESULT: FAIL/);
    });
  } finally {
    await server.close();
  }
});

test('Verifier Chaos: truncated/incomplete SSE stream does not produce PASS', async () => {
  const server = await createFakeAnthropicServer({ scenario: 'truncated-sse' });
  try {
    await withTempDir('verifier-trunc', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          test: {
            headroom_port: server.port,
            upstream: server.baseUrl
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'test',
        '-RegistryPath', regPath,
        '-ApiKey', 'synthetic-test-key',
        '-AllowLive'
      ]);

      assert.notEqual(res.status, 0);
      assert.doesNotMatch(res.stdout, /RESULT: PASS/);
    });
  } finally {
    await server.close();
  }
});

test('Verifier Chaos: offline invocation without -AllowLive exits 0 with RESULT: SKIP', async () => {
  const res = await runPowerShellAsync([
    '-File', verifierScript
  ]);

  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /RESULT: SKIP/);
  assert.match(res.stdout, /requires -AllowLive/);
});

test('Verifier Chaos: invocation without credentials exits 0 with RESULT: SKIP', async () => {
  await withTempDir('verifier-no-cred', async (dir) => {
    const regPath = path.join(dir, 'registry.json');
    fs.writeFileSync(regPath, JSON.stringify({
      profiles: {
        test: { headroom_port: 8888, upstream: 'http://127.0.0.1:8888' }
      }
    }));

    const res = await runPowerShellAsync([
      '-File', verifierScript,
      '-Profile', 'test',
      '-RegistryPath', regPath,
      '-ApiKey', '',
      '-AllowLive'
    ]);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /RESULT: SKIP/);
  });
});
