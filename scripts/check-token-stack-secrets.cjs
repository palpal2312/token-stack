const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const targets = ['core', 'bin', path.join('skills', 'token-stack-setup'), path.join('tests', 'token-stack'), path.join('tests', 'fixtures')];
const secretPattern = /sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|auth[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}/i;
const findings = [];

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.stryker-tmp') continue;
      scan(fullPath);
    } else if (/\.(cjs|js|ps1|json|md|sse|txt|ya?ml)$/.test(entry.name) && secretPattern.test(fs.readFileSync(fullPath, 'utf8'))) {
      findings.push(path.relative(root, fullPath));
    }
  }
}

for (const target of targets) {
  const directory = path.join(root, target);
  if (fs.existsSync(directory)) scan(directory);
}
if (findings.length) {
  console.error(`Credential-shaped literals found in: ${findings.join(', ')}`);
  process.exit(1);
}
console.log('Token-Stack source secret scan passed.');
