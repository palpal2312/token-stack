const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { repoRoot } = require('./helpers.cjs');
const { ModelRouter } = require(path.join(repoRoot, 'core', 'model-router.cjs'));
const { foldMessages } = require(path.join(repoRoot, 'core', 'turn-folder.cjs'));
const { SemanticCache } = require(path.join(repoRoot, 'core', 'semantic-cache.cjs'));
const { evaluateThinkingBudget } = require(path.join(repoRoot, 'core', 'cot-governor.cjs'));

test('Benchmark: ModelRouter classification latency is under 2.0ms per query', () => {
  const router = new ModelRouter();
  const iterations = 500;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    router.route('Please refactor the authentication middleware and write unit tests');
  }

  const durationNs = Number(process.hrtime.bigint() - start);
  const avgMs = (durationNs / iterations) / 1e6;

  assert.ok(avgMs < 2.0, `ModelRouter average latency too high: ${avgMs.toFixed(3)}ms`);
});

test('Benchmark: TurnFolder message folding latency is under 1.5ms per turn', () => {
  const messages = [
    { role: 'user', content: 'What files are in the repository?' },
    { role: 'assistant', content: 'I will list the directory contents.', tool_calls: [{ id: 'tc1', function: { name: 'list_dir', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'tc1', content: 'file1.txt\nfile2.txt\nfile3.txt\nfile4.txt' },
    { role: 'user', content: 'Now show me the readme' }
  ];

  const iterations = 500;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    foldMessages(messages, { liveWindow: 1 });
  }

  const durationNs = Number(process.hrtime.bigint() - start);
  const avgMs = (durationNs / iterations) / 1e6;

  assert.ok(avgMs < 1.5, `TurnFolder average latency too high: ${avgMs.toFixed(3)}ms`);
});

test('Benchmark: SemanticCache vectorization latency is under 1.0ms per text', () => {
  const cache = new SemanticCache({ dbPath: null });
  const sampleText = 'Optimize SQL database query performance using ClickHouse columnar engine and DuckDB aggregates.';
  const iterations = 500;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    cache.vectorize(sampleText);
  }

  const durationNs = Number(process.hrtime.bigint() - start);
  const avgMs = (durationNs / iterations) / 1e6;

  assert.ok(avgMs < 1.0, `SemanticCache vectorize average latency too high: ${avgMs.toFixed(3)}ms`);
});

test('Benchmark: ThinkingGovernor budget resolution is under 0.5ms per call', () => {
  const iterations = 500;
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    evaluateThinkingBudget('Design a distributed fault-tolerant architecture for agent orchestrator');
  }

  const durationNs = Number(process.hrtime.bigint() - start);
  const avgMs = (durationNs / iterations) / 1e6;

  assert.ok(avgMs < 0.5, `ThinkingGovernor average latency too high: ${avgMs.toFixed(3)}ms`);
});
