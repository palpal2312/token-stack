const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnOwnedSync, spawnOwnedAsync, cleanupAllProcesses } = require('./helpers/process-harness.cjs');
const { cleanupAllServers } = require('./helpers/network-harness.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Scrubs secret-bearing environment variables from inherited host environment.
 */
function scrubEnv(inheritedEnv = process.env, explicitEnv = {}) {
  const clean = {};
  const blockedPatterns = [/API_KEY/i, /SECRET/i, /AUTH_TOKEN/i, /PASSWORD/i, /PRIVATE_KEY/i];

  for (const [key, val] of Object.entries(inheritedEnv)) {
    const isSecret = blockedPatterns.some(pat => pat.test(key));
    if (!isSecret) {
      clean[key] = val;
    }
  }

  return {
    ...clean,
    TOKEN_STACK_REPO_ROOT: repoRoot,
    TOKEN_STACK_TEST_MODE: '1',
    ...explicitEnv
  };
}

/**
 * Creates an isolated temp dir with strict boundary validation.
 */
async function withTempDir(prefix, fn) {
  const tmpRoot = path.resolve(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmpRoot, `${prefix}-`));
  const resolvedDir = path.resolve(dir);

  // Guard against deleting anything outside tmpRoot
  const rel = path.relative(tmpRoot, resolvedDir);
  if (rel.startsWith('..') || path.isAbsolute(rel) || resolvedDir === tmpRoot) {
    throw new Error(`ILLEGAL DELETION TARGET: Temporary path ${resolvedDir} is not inside tmp root ${tmpRoot}`);
  }

  try {
    return await fn(resolvedDir);
  } finally {
    try {
      fs.rmSync(resolvedDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

/**
 * Creates a hermetic test sandbox with isolated home, appdata, registry, and scrubbed env.
 */
async function withSandbox(prefix, fn) {
  return withTempDir(prefix, async (sandboxRoot) => {
    const home = path.join(sandboxRoot, 'home');
    const appdata = path.join(sandboxRoot, 'appdata');
    const localAppdata = path.join(sandboxRoot, 'localappdata');
    const registryDir = path.join(sandboxRoot, 'registry');
    const cacheDir = path.join(sandboxRoot, 'cache');
    const binDir = path.join(sandboxRoot, 'bin');

    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(appdata, { recursive: true });
    fs.mkdirSync(localAppdata, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    const env = scrubEnv(process.env, {
      USERPROFILE: home,
      HOME: home,
      APPDATA: appdata,
      LOCALAPPDATA: localAppdata,
      TOKEN_STACK_REGISTRY_DIR: registryDir,
      TOKEN_STACK_CACHE_DIR: cacheDir,
      TOKEN_STACK_BIN_DIR: binDir
    });

    const sandbox = {
      root: sandboxRoot,
      home,
      appdata,
      localAppdata,
      registryDir,
      cacheDir,
      binDir,
      env
    };

    return await fn(sandbox);
  });
}

function runPowerShell(args, options = {}) {
  const env = scrubEnv(process.env, options.env || {});
  const timeoutMs = options.timeoutMs || 25000;
  return spawnOwnedSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env,
    timeoutMs
  });
}

async function runPowerShellAsync(args, options = {}) {
  const env = scrubEnv(process.env, options.env || {});
  const timeoutMs = options.timeoutMs || 25000;
  return spawnOwnedAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: options.cwd || repoRoot,
    env,
    timeoutMs
  });
}

module.exports = {
  repoRoot,
  scrubEnv,
  withTempDir,
  withSandbox,
  runPowerShell,
  runPowerShellAsync,
  cleanupAllProcesses,
  cleanupAllServers
};
