const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { withTempDir } = require('./helpers.cjs');
const { SemanticCache } = require('../../core/semantic-cache.cjs');
const { ModelRouter } = require('../../core/model-router.cjs');
const { evaluateThinkingBudget, modulateThinkingPayload } = require('../../core/cot-governor.cjs');
const { foldMessages } = require('../../core/turn-folder.cjs');
const { GuardrailEngine } = require('../../core/guardrail.cjs');
const { DataLens } = require('../../core/data-lens.cjs');

const corpusPath = path.join(__dirname, 'fixtures', 'fuzz', 'core-regression-corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('CORPUS [CACHE-SECRET-01]: Rejects synthetic secret token and prevents disk write', () => withTempDir('reg-cache-sec', (dir) => {
  const item = corpus.find(c => c.id === 'CACHE-SECRET-01');
  const dbPath = path.join(dir, 'cache.json');
  const cache = new SemanticCache({ dbPath });
  cache.store(item.input.prompt, item.input.response);
  assert.equal(cache.stats().entriesCount, 0);
  assert.equal(cache.find(item.input.prompt), null);
}));

test('CORPUS [CACHE-CAP-02]: Enforces 500 entry capacity limit on 501 items', () => withTempDir('reg-cache-cap', (dir) => {
  const item = corpus.find(c => c.id === 'CACHE-CAP-02');
  const dbPath = path.join(dir, 'cache.json');
  const cache = new SemanticCache({ dbPath, threshold: 1 });
  for (let i = 0; i < item.input.entryCount; i++) {
    cache.store(`prompt ${i}`, `response ${i}`);
  }
  assert.equal(cache.stats().entriesCount, item.expected.maxEntries);
}));

test('CORPUS [CACHE-CORRUPT-03]: Graceful recovery from malformed storage file', () => withTempDir('reg-cache-corrupt', (dir) => {
  const item = corpus.find(c => c.id === 'CACHE-CORRUPT-03');
  const dbPath = path.join(dir, 'cache.json');
  fs.writeFileSync(dbPath, item.input.rawFileContent, 'utf8');
  const cache = new SemanticCache({ dbPath });
  assert.equal(cache.stats().entriesCount, item.expected.entriesCount);
}));

test('CORPUS [FOLD-PRESERVE-01]: Preserves live window turns completely intact', () => {
  const item = corpus.find(c => c.id === 'FOLD-PRESERVE-01');
  const messages = [
    { role: 'user', content: 'Turn 1' },
    { role: 'assistant', content: 'Turn 2' },
    { role: 'user', content: 'Turn 3' },
    { role: 'assistant', content: 'Turn 4' }
  ];
  const folded = foldMessages(messages, { liveWindow: item.input.liveWindow });
  assert.deepEqual(folded, messages);
});

test('CORPUS [FOLD-PRESERVE-02]: Never folds tool result containing error or exception string', () => {
  const item = corpus.find(c => c.id === 'FOLD-PRESERVE-02');
  const messages = [
    item.input,
    { role: 'assistant', content: 'Turn 2' },
    { role: 'user', content: 'Turn 3' },
    { role: 'assistant', content: 'Turn 4' },
    { role: 'user', content: 'Turn 5' },
    { role: 'assistant', content: 'Turn 6' }
  ];
  const folded = foldMessages(messages, { epochSize: 2, liveWindow: 2, minLinesThreshold: 10, charThreshold: 50 });
  // The first message's tool_result content must remain completely unfolded
  assert.equal(folded[0].content[0].content, item.input.content[0].content);
});

test('CORPUS [COT-BOUND-01]: Explicit budget override comment is strictly respected', () => {
  const item = corpus.find(c => c.id === 'COT-BOUND-01');
  const budget = evaluateThinkingBudget(item.input.prompt);
  assert.equal(budget, item.expected.budget);
});

test('CORPUS [COT-BOUND-02]: Low complexity prompt gets bounded to 1024 tokens', () => {
  const item = corpus.find(c => c.id === 'COT-BOUND-02');
  const budget = evaluateThinkingBudget(item.input.prompt, item.input.fileCount);
  assert.equal(budget, item.expected.budget);
});

test('CORPUS [COT-BOUND-03]: High complexity architecture keyword triggers 8192 budget', () => {
  const item = corpus.find(c => c.id === 'COT-BOUND-03');
  const budget = evaluateThinkingBudget(item.input.prompt, item.input.fileCount);
  assert.equal(budget, item.expected.budget);
});

test('CORPUS [GUARD-FAIL-CLOSED-01]: Detects runaway loop after exactly 3 identical tool calls', () => {
  const item = corpus.find(c => c.id === 'GUARD-FAIL-CLOSED-01');
  const guard = new GuardrailEngine();
  guard.evaluateToolCall(item.input.tool, item.input.args);
  guard.evaluateToolCall(item.input.tool, item.input.args);
  const result = guard.evaluateToolCall(item.input.tool, item.input.args);
  assert.equal(result.isLoop, item.expected.isLoop);
});

test('CORPUS [GUARD-FAIL-CLOSED-02]: Waterfall fails over on 429 and terminates on 400 without false retry', async () => {
  const item = corpus.find(c => c.id === 'GUARD-FAIL-CLOSED-02');
  const guard = new GuardrailEngine();
  const tiers = [{ name: 'primary' }, { name: 'fallback' }];
  let calls = 0;

  await assert.rejects(async () => {
    await guard.executeWaterfall(async (tier) => {
      calls++;
      if (tier.name === 'primary') {
        return { status: 429, statusText: 'Too Many Requests' };
      }
      throw new Error('HTTP 400 Bad Request');
    }, tiers);
  }, /HTTP 400 Bad Request/);

  assert.equal(calls, 2);
});

test('CORPUS [DATA-LENS-01]: Handles empty string and whitespace without crashing', () => {
  const item = corpus.find(c => c.id === 'DATA-LENS-01');
  const lens = new DataLens();
  const profile = lens.profileData(item.input.csv);
  assert.match(profile, /Empty dataset/);
});

test('CORPUS [MODEL-ROUTER-01]: Explicit slash model override takes precedence over complexity', () => {
  const item = corpus.find(c => c.id === 'MODEL-ROUTER-01');
  const router = new ModelRouter();
  const res = router.route(item.input.prompt, { filesCount: item.input.filesCount });
  assert.equal(res.selectedModel, item.expected.selectedModel);
  assert.equal(res.isOverride, item.expected.isOverride);
});
