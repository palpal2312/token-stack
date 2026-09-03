const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShellAsync, withTempDir } = require('./helpers.cjs');
const { createFakeAnthropicServer } = require('./helpers/fake-anthropic-server.cjs');

const verifierScript = path.join(repoRoot, 'core', 'verifier.ps1');

test('Redaction: synthetic API key canary never leaks to stdout, stderr, or disk', async () => {
  const canaryRaw = 'test-canary-secret-alpha99';
  const canaryB64 = Buffer.from(canaryRaw).toString('base64');
  const canaryUrl = encodeURIComponent(canaryRaw);

  const server = await createFakeAnthropicServer({ scenario: 'ready-pass' });
  try {
    await withTempDir('redaction-test', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          secure: {
            headroom_port: server.port,
            upstream: server.baseUrl,
            model: 'claude-sonnet-4-5-thinking'
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'secure',
        '-RegistryPath', regPath,
        '-ApiKey', canaryRaw,
        '-AllowLive'
      ]);

      const output = res.stdout + '\n' + res.stderr;

      // Assert raw canary is never printed
      assert.equal(output.includes(canaryRaw), false, 'Raw credential canary leaked to console output!');
      assert.equal(output.includes(canaryB64), false, 'Base64 credential canary leaked to console output!');
      assert.equal(output.includes(canaryUrl), false, 'URL-encoded credential canary leaked to console output!');

      // Check all files in temp dir
      const files = fs.readdirSync(dir, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.equal(content.includes(canaryRaw), false, `Canary leaked to disk file: ${file}`);
        }
      }
    });
  } finally {
    await server.close();
  }
});

test('Redaction: upstream error response body is redacted and does not print raw payload', async () => {
  const server = await createFakeAnthropicServer({ scenario: 'upstream-500' });
  try {
    await withTempDir('redaction-err', async (dir) => {
      const regPath = path.join(dir, 'registry.json');
      fs.writeFileSync(regPath, JSON.stringify({
        profiles: {
          secure: {
            headroom_port: server.port,
            upstream: server.baseUrl
          }
        }
      }));

      const res = await runPowerShellAsync([
        '-File', verifierScript,
        '-Profile', 'secure',
        '-RegistryPath', regPath,
        '-ApiKey', 'canary-val-123',
        '-AllowLive'
      ]);

      assert.match(res.stdout, /Response body redacted|FAIL/);
      assert.equal(res.stdout.includes('canary-val-123'), false);
    });
  } finally {
    await server.close();
  }
});
