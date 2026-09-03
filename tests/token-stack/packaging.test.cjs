const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot } = require('./helpers.cjs');

test('Packaging: package.json has valid metadata, scripts, and dependencies', () => {
  const pkgPath = path.join(repoRoot, 'package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json missing');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.name);
  assert.ok(pkg.version);

  // Assert essential token-stack scripts exist
  assert.ok(pkg.scripts['test:token-stack'], 'Missing test:token-stack script');
  assert.ok(pkg.scripts['test:token-stack:coverage'], 'Missing test:token-stack:coverage script');

  // Assert fast-check is declared in devDependencies
  assert.ok(pkg.devDependencies['fast-check'], 'fast-check missing from devDependencies');
});

test('Packaging: all core CommonJS modules load cleanly with valid syntax and exports', () => {
  const coreDir = path.join(repoRoot, 'core');
  const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.cjs'));

  assert.ok(files.length >= 6, 'Insufficient core modules found');

  for (const file of files) {
    const fullPath = path.join(coreDir, file);
    assert.doesNotThrow(() => {
      require(fullPath);
    }, `Failed to require core module: ${file}`);
  }
});

test('Packaging: CLI and configuration entrypoints exist and are non-empty', () => {
  const binScript = path.join(repoRoot, 'bin', 'token-stack.ps1');
  assert.ok(fs.existsSync(binScript), 'bin/token-stack.ps1 missing');
  assert.ok(fs.statSync(binScript).size > 1000);

  const regScript = path.join(repoRoot, 'core', 'registry.ps1');
  assert.ok(fs.existsSync(regScript), 'core/registry.ps1 missing');

  const portScript = path.join(repoRoot, 'core', 'port-allocator.ps1');
  assert.ok(fs.existsSync(portScript), 'core/port-allocator.ps1 missing');
});
