#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const configDir = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const ledgerPath = path.join(configDir, 'token-stack-usage.jsonl');
const lockPath = `${ledgerPath}.lock`;
const VALID_CAVEMAN_MODES = new Set([
  'off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full',
  'wenyan-ultra', 'commit', 'review', 'compress',
]);
const VALID_PONYTAIL_MODES = new Set(['off', 'lite', 'full', 'ultra', 'review']);

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('error', () => resolve(input));
    process.stdin.on('end', () => resolve(input));
    if (process.stdin.isTTY) resolve('');
  });
}

function safeMode(filePath, validModes) {
  try {
    const mode = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
    return validModes.has(mode) ? mode : 'off';
  } catch (_) {
    return 'off';
  }
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function transcriptUsage(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return null;
  }

  const totals = {
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let model = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    if (entry.type !== 'assistant' || !entry.message || !entry.message.usage) continue;
    const usage = entry.message.usage;
    totals.turns += 1;
    for (const key of Object.keys(totals).filter((key) => key !== 'turns')) {
      const value = Number(usage[key]);
      if (Number.isFinite(value) && value >= 0) totals[key] += value;
    }
    if (!model && typeof entry.message.model === 'string') model = entry.message.model;
  }
  return { ...totals, model };
}

function acquireLock() {
  try {
    return fs.openSync(lockPath, 'wx');
  } catch (_) {
    return null;
  }
}

function releaseLock(fd) {
  if (fd === null) return;
  try { fs.closeSync(fd); } catch (_) {}
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

function appendOnce(record) {
  fs.mkdirSync(configDir, { recursive: true });
  const fd = acquireLock();
  if (fd === null) return false;
  try {
    let existing = '';
    try { existing = fs.readFileSync(ledgerPath, 'utf8'); } catch (_) {}
    const rows = existing.split(/\r?\n/).filter(Boolean);
    let replaced = false;
    const next = rows.map((line) => {
      try {
        const current = JSON.parse(line);
        if (current.session_id !== record.session_id) return line;
        replaced = true;
        return JSON.stringify(record);
      } catch (_) {
        return line;
      }
    });
    if (!replaced) next.push(JSON.stringify(record));
    const tempPath = `${ledgerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${next.join(os.EOL)}${os.EOL}`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, ledgerPath);
    return true;
  } finally {
    releaseLock(fd);
  }
}

function readRecords() {
  try {
    return fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record && typeof record.session_id === 'string');
  } catch (_) {
    return [];
  }
}

function summarizeRecords() {
  const records = readRecords();
  const sum = (key) => records.reduce((total, record) => total + (Number(record[key]) || 0), 0);
  return {
    sessions: records.length,
    turns: sum('turns'),
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_creation_input_tokens: sum('cache_creation_input_tokens'),
    cache_read_input_tokens: sum('cache_read_input_tokens'),
    first_recorded_at: records[0]?.recorded_at || null,
    last_recorded_at: records[records.length - 1]?.recorded_at || null,
  };
}

function runCavemanStats(transcriptPath) {
  const candidates = [
    path.join(configDir, 'plugins', 'marketplaces', 'caveman', 'src', 'hooks', 'caveman-stats.js'),
    path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'caveman', 'src', 'hooks', 'caveman-stats.js'),
  ];
  const statsPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!statsPath) return;
  try {
    execFileSync(process.execPath, [statsPath, '--session-file', transcriptPath], {
      cwd: configDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch (_) {}
}

function processPayload(payload) {
  const transcript = typeof payload.transcript_path === 'string' ? path.resolve(payload.transcript_path) : null;
  if (!transcript || !isWithin(transcript, path.join(configDir, 'projects')) || !fs.existsSync(transcript)) return false;
  const usage = transcriptUsage(transcript);
  if (!usage || usage.turns === 0) return false;

  const sessionId = typeof payload.session_id === 'string' && payload.session_id.trim()
    ? payload.session_id.trim()
    : path.basename(transcript, path.extname(transcript));
  const record = {
    recorded_at: new Date().toISOString(),
    session_id: sessionId,
    transcript_path: transcript,
    model: usage.model,
    caveman_mode: safeMode(path.join(configDir, '.caveman-active'), VALID_CAVEMAN_MODES),
    ponytail_mode: safeMode(path.join(configDir, '.ponytail-active'), VALID_PONYTAIL_MODES),
    ...usage,
  };
  const written = appendOnce(record);
  runCavemanStats(transcript);
  return written;
}

async function main() {
  if (process.argv.includes('--summary')) {
    process.stdout.write(`${JSON.stringify(summarizeRecords())}\n`);
    return;
  }
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw); } catch (_) { return; }
  if (!payload || payload.hook_event_name === 'SubagentStop') return;
  processPayload(payload);
}

if (require.main === module) {
  main().catch(() => {}).finally(() => process.exit(0));
}

module.exports = {
  appendOnce,
  isWithin,
  processPayload,
  readRecords,
  safeMode,
  summarizeRecords,
  transcriptUsage,
};
