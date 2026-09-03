/**
 * Token-Stack Deep Adversarial Test Program: Filesystem Snapshot & Boundary Guard
 * Takes deterministic snapshots of protected directories and validates containment.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashFile(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

function takeSnapshot(rootDir, options = {}) {
  const snapshot = new Map();
  if (!fs.existsSync(rootDir)) {
    return snapshot;
  }

  const maxDepth = options.maxDepth || 10;
  const ignorePatterns = options.ignore || ['.git', 'node_modules', '.temp'];

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignorePatterns.some(pat => entry.name === pat)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          snapshot.set(relPath, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            hash: options.computeHash !== false ? hashFile(fullPath) : null
          });
        } catch {
          // File may have been deleted or inaccessible
        }
      }
    }
  }

  walk(rootDir, 0);
  return snapshot;
}

function diffSnapshots(before, after) {
  const created = [];
  const modified = [];
  const deleted = [];

  for (const [relPath, afterMeta] of after.entries()) {
    if (!before.has(relPath)) {
      created.push(relPath);
    } else {
      const beforeMeta = before.get(relPath);
      if (
        beforeMeta.size !== afterMeta.size ||
        (beforeMeta.hash && afterMeta.hash && beforeMeta.hash !== afterMeta.hash)
      ) {
        modified.push(relPath);
      }
    }
  }

  for (const relPath of before.keys()) {
    if (!after.has(relPath)) {
      deleted.push(relPath);
    }
  }

  return { created, modified, deleted, hasChanges: created.length > 0 || modified.length > 0 || deleted.length > 0 };
}

function assertNoEscapes(allowedRootDir, candidatePath) {
  const resolvedRoot = path.resolve(allowedRootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`FILESYSTEM ESCAPE DETECTED: Path '${resolvedCandidate}' is outside allowed root '${resolvedRoot}'.`);
  }
}

module.exports = {
  takeSnapshot,
  diffSnapshots,
  assertNoEscapes
};
