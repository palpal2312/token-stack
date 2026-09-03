/**
 * Token-Stack Deep Adversarial Test Program: Process Harness & Ownership Guard
 * Enforces verified PID ownership, per-child execution deadlines, tree-kill, and zero orphan processes.
 */

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');

const isWindows = process.platform === 'win32';
const trackedProcesses = new Map(); // pid -> { pid, runId, command, args, startTime, child, exited }

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // Exists but no permission
  }
}

function treeKill(pid) {
  if (!pid) return;
  if (isWindows) {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
}

/**
 * Spawns an owned child process with tracking and timeout.
 * @param {string} command
 * @param {Array<string>} args
 * @param {Object} options
 * @returns {Promise<{ status: number|null, stdout: string, stderr: string, pid: number, runId: string, timedOut: boolean, durationMs: number }>}
 */
function spawnOwnedProcess(command, args, options = {}) {
  const runId = crypto.randomBytes(6).toString('hex');
  const timeoutMs = options.timeoutMs || options.timeout || 45000;
  const startTime = Date.now();

  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  if (!child.pid) {
    throw new Error(`Failed to obtain PID for spawned process: ${command}`);
  }

  const pid = child.pid;
  const record = {
    pid,
    runId,
    command,
    args,
    startTime,
    child,
    exited: false
  };
  trackedProcesses.set(pid, record);

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let timer = null;

  if (child.stdout) {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (typeof options.onStdout === 'function') options.onStdout(chunk.toString('utf8'));
    });
  }
  if (child.stderr) {
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (typeof options.onStderr === 'function') options.onStderr(chunk.toString('utf8'));
    });
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      treeKill(pid);
    }, timeoutMs);
  }

  const promise = new Promise((resolve, reject) => {
    child.on('error', err => {
      if (timer) clearTimeout(timer);
      record.exited = true;
      trackedProcesses.delete(pid);
      reject(err);
    });

    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      record.exited = true;
      trackedProcesses.delete(pid);
      const durationMs = Date.now() - startTime;
      resolve({
        status: timedOut ? 124 : status,
        signal,
        stdout,
        stderr,
        pid,
        runId,
        timedOut,
        durationMs
      });
    });
  });

  return { child, pid, runId, promise };
}

/**
 * Spawns an owned child process with tracking and timeout.
 */
function spawnOwnedAsync(command, args, options = {}) {
  return spawnOwnedProcess(command, args, options).promise;
}

/**
 * Spawns an owned synchronous child process with tracking and timeout.
 */
function spawnOwnedSync(command, args, options = {}) {
  const runId = crypto.randomBytes(6).toString('hex');
  const timeout = options.timeoutMs || options.timeout || 45000;
  const startTime = Date.now();

  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: options.encoding || 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024
  });

  const durationMs = Date.now() - startTime;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');

  if (result.pid) {
    if (timedOut) {
      treeKill(result.pid);
    }
  }

  return {
    status: timedOut ? 124 : result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
    error: result.error,
    pid: result.pid,
    runId,
    timedOut,
    durationMs
  };
}

/**
 * Safely kills an owned process only. Throws if the PID is foreign or unowned.
 */
function terminateOwnedProcess(pid) {
  if (!trackedProcesses.has(pid)) {
    throw new Error(`REFUSAL TO TERMINATE UNOWNED PROCESS: PID ${pid} is not managed by this test harness.`);
  }
  treeKill(pid);
  trackedProcesses.delete(pid);
}

/**
 * Emergency cleanup for all active tracked processes.
 */
function cleanupAllProcesses() {
  for (const [pid, record] of trackedProcesses.entries()) {
    if (!record.exited) {
      treeKill(pid);
    }
  }
  trackedProcesses.clear();
}

/**
 * Verifies that zero owned processes remain running.
 */
function verifyZeroOrphanProcesses() {
  const orphans = [];
  for (const [pid, record] of trackedProcesses.entries()) {
    if (isProcessAlive(pid)) {
      orphans.push({ pid, command: record.command, runId: record.runId });
    }
  }
  if (orphans.length > 0) {
    cleanupAllProcesses();
    throw new Error(`ORPHAN PROCESSES DETECTED: ${JSON.stringify(orphans)}`);
  }
  return true;
}

module.exports = {
  isProcessAlive,
  treeKill,
  spawnOwnedProcess,
  spawnOwnedAsync,
  spawnOwnedSync,
  terminateOwnedProcess,
  cleanupAllProcesses,
  verifyZeroOrphanProcesses,
  trackedProcesses
};
