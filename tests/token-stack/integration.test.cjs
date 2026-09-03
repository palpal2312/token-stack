const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { repoRoot, runPowerShell, runPowerShellAsync, withTempDir } = require('./helpers.cjs');

test('repository-local CLI exposes help without a globally installed command', () => {
  const result = runPowerShell(['-File', path.join(repoRoot, 'bin', 'token-stack.ps1'), 'help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Token-Stack 3\.2 CLI/);
});

test('CLI refuses process control unless explicitly enabled', () => {
  const result = runPowerShell(['-File', path.join(repoRoot, 'bin', 'token-stack.ps1'), 'down']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not own persistent process handles/);
});

test('CLI verifier skips without an explicit live flag', () => {
  const result = runPowerShell(['-File', path.join(repoRoot, 'bin', 'token-stack.ps1'), 'verify']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT: SKIP/);
});

test('setup apply confines its outputs to injected directories', () => withTempDir('token-stack-setup', (dir) => {
  const profile = path.join(dir, 'profile');
  const home = path.join(dir, 'home');
  const globalBin = path.join(dir, 'bin');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  const script = path.join(repoRoot, 'skills', 'token-stack-setup', 'scripts', 'token-stack-setup.ps1');
  const result = runPowerShell(['-File', script, '-ProfileDirectory', profile, '-TokenStackHome', home, '-GlobalBinDirectory', globalBin, '-Offline', '-Apply'], { env: { USERPROFILE: dir, HOME: dir } });
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.enabledPlugins['caveman@caveman'], true);
  assert.equal(fs.existsSync(path.join(home, 'router-config.json')), true);
  assert.equal(fs.existsSync(path.join(globalBin, 'token-stack.cmd')), true);
}));

test('setup is idempotent and safely backs up malformed settings in its temporary profile', () => withTempDir('token-stack-setup-malformed', (dir) => {
  const profile = path.join(dir, 'profile');
  const home = path.join(dir, 'home');
  const globalBin = path.join(dir, 'bin');
  fs.mkdirSync(profile, { recursive: true });
  const settingsPath = path.join(profile, 'settings.json');
  fs.writeFileSync(settingsPath, '{broken json');
  const script = path.join(repoRoot, 'skills', 'token-stack-setup', 'scripts', 'token-stack-setup.ps1');
  const args = ['-File', script, '-ProfileDirectory', profile, '-TokenStackHome', home, '-GlobalBinDirectory', globalBin, '-Offline', '-Apply'];
  const first = runPowerShell(args, { env: { USERPROFILE: dir, HOME: dir } });
  assert.equal(first.status, 0, first.stderr);
  const backups = fs.readdirSync(profile).filter((name) => name.includes('.corrupted.') && name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  const second = runPowerShell(args, { env: { USERPROFILE: dir, HOME: dir } });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).enabledPlugins['ponytail@ponytail'], true);
}));

test('verifier source has no embedded credential-shaped fallback', () => {
  const verifier = fs.readFileSync(path.join(repoRoot, 'core', 'verifier.ps1'), 'utf8');
  assert.doesNotMatch(verifier, /sk-[A-Za-z0-9]{20,}/);
  assert.match(verifier, /RegistryPath/);
  assert.match(verifier, /TOKEN_STACK_API_KEY/);
  assert.match(verifier, /AllowLive/);
  assert.match(verifier, /RESULT: FAIL/);
  assert.match(verifier, /Response body redacted/);
});

test('verifier returns PASS through a controlled loopback proxy and upstream', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/readyz') {
      response.writeHead(200).end('ok');
      return;
    }
    if (request.url === '/v1/messages') {
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end('event: message_start\ndata: {}\n\n');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await withTempDir('token-stack-verifier', async (dir) => {
      const registryPath = path.join(dir, 'registry.json');
      fs.writeFileSync(registryPath, JSON.stringify({ profiles: { fixture: { headroom_port: port, upstream: `http://127.0.0.1:${port}`, model: 'fixture' } } }));
      const result = await runPowerShellAsync(['-File', path.join(repoRoot, 'core', 'verifier.ps1'), '-Profile', 'fixture', '-RegistryPath', registryPath, '-ApiKey', 'synthetic-live-test-key', '-AllowLive']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /RESULT: PASS/);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('registry and port allocator work against explicit temporary state', () => withTempDir('token-stack-registry', (dir) => {
  const registryPath = path.join(dir, 'registry.json');
  const registry = { version: 'test', profiles: { fixture: { headroom_port: 0 } } };
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  const command = [
    `. '${path.join(repoRoot, 'core', 'registry.ps1')}'`,
    `. '${path.join(repoRoot, 'core', 'port-allocator.ps1')}'`,
    `$registry = Get-TokenStackRegistry -Path '${registryPath.replace(/\\/g, '/')}'`,
    `if ($registry.profiles.fixture.headroom_port -ne 0) { exit 2 }`,
    `$port = Find-FreeHeadroomPort -StartPort 41000 -EndPort 41010`,
    `if ($port -lt 41000 -or $port -gt 41010) { exit 3 }`
  ].join('; ');
  const result = runPowerShell(['-Command', command]);
  assert.equal(result.status, 0, result.stderr);
}));

test('profile commands mutate only an injected temporary registry', () => withTempDir('token-stack-profile', (dir) => {
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({ profiles: {} }));
  const cli = path.join(repoRoot, 'bin', 'token-stack.ps1');
  const env = { TOKEN_STACK_REGISTRY: registryPath, USERPROFILE: dir, HOME: dir };
  const add = runPowerShell(['-File', cli, 'profile', 'add', 'fixture'], { env });
  assert.equal(add.status, 0, add.stderr);
  assert.ok(JSON.parse(fs.readFileSync(registryPath, 'utf8')).profiles.fixture);
  const remove = runPowerShell(['-File', cli, 'profile', 'remove', 'fixture'], { env });
  assert.equal(remove.status, 0, remove.stderr);
  assert.equal(JSON.parse(fs.readFileSync(registryPath, 'utf8')).profiles.fixture, undefined);
}));
