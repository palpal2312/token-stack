const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { repoRoot, withTempDir } = require('./helpers.cjs');
const { SemanticCache } = require(path.join(repoRoot, 'core', 'semantic-cache.cjs'));
const { foldMessages } = require(path.join(repoRoot, 'core', 'turn-folder.cjs'));
const { evaluateThinkingBudget } = require(path.join(repoRoot, 'core', 'cot-governor.cjs'));
const { ModelRouter } = require(path.join(repoRoot, 'core', 'model-router.cjs'));
const { GuardrailEngine } = require(path.join(repoRoot, 'core', 'guardrail.cjs'));
const { verifyPortRebindable, createLoopbackServer } = require('./helpers/network-harness.cjs');

test('Soak: memory bounds remain stable across 1,000 pipeline cycles', () => {
  const router = new ModelRouter();

  if (global.gc) global.gc();
  const initialHeap = process.memoryUsage().heapUsed;

  for (let i = 0; i < 1000; i++) {
    // 1. Turn Folding
    const folded = foldMessages([
      { role: 'user', content: `Request cycle ${i}` },
      { role: 'assistant', content: 'Processing step', tool_calls: [{ id: `tc_${i}`, function: { name: 'bash', arguments: 'ls' } }] },
      { role: 'user', content: `Feedback iteration ${i}` }
    ], { liveWindow: 1 });
    assert.ok(folded.length > 0);

    // 2. CoT Governor
    const budget = evaluateThinkingBudget(`cycle task ${i}`);
    assert.ok(budget >= 1024);

    // 3. Model Router
    const route = router.route(`query ${i} optimize database index performance`);
    assert.ok(route.tier);
  }

  if (global.gc) global.gc();
  const finalHeap = process.memoryUsage().heapUsed;
  const growthMb = (finalHeap - initialHeap) / (1024 * 1024);

  // Heap growth must remain bounded under 35MB
  assert.ok(growthMb < 35, `Heap grew excessively: ${growthMb.toFixed(2)} MB`);
});

test('Soak: SemanticCache capacity ceiling strictly holds under 1,500 inserts', () => withTempDir('cache-soak', (dir) => {
  const dbPath = path.join(dir, 'soak-cache.json');
  const cache = new SemanticCache({ dbPath });

  for (let i = 0; i < 1500; i++) {
    cache.store(`query_prompt_${i}`, `response_result_${i}`);
  }

  const count = cache.entries.length;
  assert.equal(count, 500, `Cache exceeded capacity bound: ${count} entries`);

  // Verify recent entry can be found
  const recentMatch = cache.find('query_prompt_1499');
  assert.ok(recentMatch);
  assert.equal(recentMatch.response, 'response_result_1499');
}));

test('Soak: GuardrailEngine detects repeating patterns reliably under sustained stress', () => {
  const breaker = new GuardrailEngine({ maxConsecutiveLoops: 3 });

  for (let round = 0; round < 100; round++) {
    const r1 = breaker.evaluateToolCall('read_file', { path: `same-file-${round}.txt` });
    assert.equal(r1.isLoop, false);

    const r2 = breaker.evaluateToolCall('read_file', { path: `same-file-${round}.txt` });
    assert.equal(r2.isLoop, false);

    const r3 = breaker.evaluateToolCall('read_file', { path: `same-file-${round}.txt` });
    assert.equal(r3.isLoop, true);

    breaker.reset();
    assert.equal(breaker.ringBuffer.length, 0);
  }
});

test('Soak: network socket handles close cleanly without port exhaustion', async () => {
  const server = await createLoopbackServer(async (req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  try {
    const http = require('node:http');
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve, reject) => {
        const req = http.get(server.baseUrl, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });
        req.on('error', reject);
      });
    }
  } finally {
    await server.close();
  }

  const rebindable = await verifyPortRebindable(server.port, '127.0.0.1');
  assert.equal(rebindable, true);
});
