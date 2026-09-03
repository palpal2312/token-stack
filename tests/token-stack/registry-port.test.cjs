const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, runPowerShell, withSandbox } = require('./helpers.cjs');

const regScript = path.join(repoRoot, 'core', 'registry.ps1');
const portScript = path.join(repoRoot, 'core', 'port-allocator.ps1');

test('Registry: returns valid default schema when file does not exist', () => withSandbox('reg-schema', (sandbox) => {
  const regPath = path.join(sandbox.registryDir, 'nonexistent.json');
  const cmd = [
    `. '${regScript.replace(/\\/g, '/')}'`,
    `$reg = Get-TokenStackRegistry -Path '${regPath.replace(/\\/g, '/')}'`,
    `if ($reg.version -ne '2.0.0' -or -not $reg.profiles) { exit 1 }`
  ].join('; ');

  const result = runPowerShell(['-Command', cmd]);
  assert.equal(result.status, 0, result.stderr);
}));

test('Registry: Set, Get, and Remove profile operations are consistent', () => withSandbox('reg-crud', (sandbox) => {
  const regPath = path.join(sandbox.registryDir, 'registry.json');
  const cmd = [
    `. '${regScript.replace(/\\/g, '/')}'`,
    `Set-TokenStackProfile -Name 'agent1' -Config @{ headroom_port = 8801; upstream = 'http://127.0.0.1:8801' } -Path '${regPath.replace(/\\/g, '/')}'`,
    `$p1 = Get-TokenStackProfile -Name 'agent1' -Path '${regPath.replace(/\\/g, '/')}'`,
    `if ($p1.headroom_port -ne 8801) { exit 2 }`,
    `$removed = Remove-TokenStackProfile -Name 'agent1' -Path '${regPath.replace(/\\/g, '/')}'`,
    `if (-not $removed) { exit 3 }`,
    `$p1After = Get-TokenStackProfile -Name 'agent1' -Path '${regPath.replace(/\\/g, '/')}'`,
    `if ($p1After) { exit 4 }`
  ].join('; ');

  const result = runPowerShell(['-Command', cmd]);
  assert.equal(result.status, 0, result.stderr);

  // Assert file on disk is valid JSON
  const data = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  assert.equal(data.profiles.agent1, undefined);
}));

test('Port Allocator: Find-FreeHeadroomPort respects reserved ports and bounds', () => {
  const cmd = [
    `. '${portScript.replace(/\\/g, '/')}'`,
    `$port = Find-FreeHeadroomPort -StartPort 42000 -EndPort 42010 -ReservedPorts @(42000, 42001)`,
    `if ($port -le 42001 -or $port -gt 42010) { exit 1 }`
  ].join('; ');

  const result = runPowerShell(['-Command', cmd]);
  assert.equal(result.status, 0, result.stderr);
});

test('Port Allocator: Throws when port range is completely exhausted', () => {
  const cmd = [
    `. '${portScript.replace(/\\/g, '/')}'`,
    `try {`,
    `  Find-FreeHeadroomPort -StartPort 43000 -EndPort 43002 -ReservedPorts @(43000, 43001, 43002)`,
    `  exit 1`, // Should not reach here
    `} catch {`,
    `  exit 0`, // Expected throw
    `}`
  ].join('; ');

  const result = runPowerShell(['-Command', cmd]);
  assert.equal(result.status, 0, result.stderr);
});
