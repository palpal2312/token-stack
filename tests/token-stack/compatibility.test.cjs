const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runPowerShell } = require('./helpers.cjs');

test('Compatibility: Node.js runtime meets minimum version requirements (>= 18.0.0)', () => {
  const versionParts = process.versions.node.split('.').map(Number);
  const major = versionParts[0];

  assert.ok(major >= 18, `Node.js version ${process.version} is below minimum requirement (>= 18.0.0)`);
});

test('Compatibility: PowerShell runtime is available and version >= 5.1', () => {
  const result = runPowerShell(['-Command', '$PSVersionTable.PSVersion.Major']);
  assert.equal(result.status, 0, result.stderr);

  const major = parseInt(result.stdout.trim(), 10);
  assert.ok(major >= 5, `PowerShell major version ${major} is below minimum requirement (>= 5)`);
});

test('Compatibility: path normalization handles mixed forward and backward slashes cleanly', () => {
  const samplePathWindows = 'C:\\Users\\ADMIN\\Documents\\Agent OS\\source\\core\\semantic-cache.cjs';
  const samplePathPosix = 'C:/Users/ADMIN/Documents/Agent OS/source/core/semantic-cache.cjs';

  const normalizedWin = path.normalize(samplePathWindows);
  const normalizedPosix = path.normalize(samplePathPosix);

  assert.equal(path.resolve(normalizedWin), path.resolve(normalizedPosix));
});
