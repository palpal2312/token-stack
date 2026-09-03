const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withTempDir } = require('./helpers.cjs');
const { SemanticCache } = require('../../core/semantic-cache.cjs');
const { ModelRouter } = require('../../core/model-router.cjs');
const { evaluateThinkingBudget, modulateThinkingPayload } = require('../../core/cot-governor.cjs');
const { foldMessages, processOutgoingPayload } = require('../../core/turn-folder.cjs');
const { GuardrailEngine } = require('../../core/guardrail.cjs');
const { DataLens } = require('../../core/data-lens.cjs');
const { SkillRouter } = require('../../core/skill-router.cjs');

test('semantic cache persists only within its injected path and rejects secrets', () => withTempDir('token-stack-cache', (dir) => {
  const dbPath = path.join(dir, 'cache.json');
  const cache = new SemanticCache({ dbPath, threshold: 0.8 });
  cache.store('How do I handle rate limits?', 'Retry with backoff.', 'test-model');
  assert.equal(cache.find('How do I handle rate limits?').response, 'Retry with backoff.');
  cache.store('secret=synthetic-test-value', 'must not persist');
  assert.equal(cache.stats().entriesCount, 1);
  assert.equal(new SemanticCache({ dbPath }).stats().entriesCount, 1);
  assert.equal(fs.existsSync(dbPath), true);
}));

test('semantic cache recovers from malformed storage and enforces its capacity cap', () => withTempDir('token-stack-cache-invalid', (dir) => {
  const dbPath = path.join(dir, 'cache.json');
  fs.writeFileSync(dbPath, '{invalid json');
  const cache = new SemanticCache({ dbPath, threshold: 1 });
  assert.equal(cache.stats().entriesCount, 0);
  for (let index = 0; index < 501; index += 1) cache.store(`prompt ${index}`, `response ${index}`);
  assert.equal(cache.stats().entriesCount, 500);
}));

test('model router respects explicit overrides and conservative fallback', () => {
  const router = new ModelRouter();
  assert.equal(router.route('Format this README').tier, 'cheap');
  assert.equal(router.route('Design a distributed scheduler').tier, 'flagship');
  assert.equal(router.route('/model custom-model').selectedModel, 'custom-model');
  assert.equal(router.route(null).tier, 'flagship');
  assert.equal(router.route('Implement feature', { filesCount: 4 }).tier, 'flagship');
  assert.equal(new ModelRouter({ defaultCheapModel: 'deepseek-v3' }).route('Fix typo').estimatedSavingsPercent, 90);
});

test('thinking governor leaves disabled payloads alone and handles malformed messages', () => {
  const disabled = { thinking: { type: 'disabled' }, max_tokens: 20 };
  assert.deepEqual(modulateThinkingPayload(disabled), { payload: disabled, modulated: false, assignedBudget: null });
  const malformed = { thinking: { type: 'enabled', budget_tokens: 1 }, messages: [{ role: 'user', content: [{ type: 'image' }] }] };
  assert.equal(modulateThinkingPayload(malformed).assignedBudget, 4096);
});

test('thinking governor applies override and preserves a usable max token budget', () => {
  assert.equal(evaluateThinkingBudget('Fix typo'), 1024);
  assert.equal(evaluateThinkingBudget('Design distributed architecture', 4), 8192);
  const payload = { max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 8000 }, messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix typo' }] }] };
  const result = modulateThinkingPayload(payload);
  assert.equal(result.modulated, true);
  assert.equal(payload.thinking.budget_tokens, 1024);
  assert.ok(payload.max_tokens >= 5120);
});

test('turn folder preserves schema and live-window content', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n');
  const messages = Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: long }] }));
  const folded = foldMessages(messages, { epochSize: 2, liveWindow: 2, charThreshold: 20, minLinesThreshold: 4 });
  assert.equal(folded.length, messages.length);
  assert.equal(folded[0].content[0].tool_use_id, 'tool-0');
  assert.match(folded[0].content[0].content, /Folded/);
  assert.doesNotMatch(folded.at(-1).content[0].content, /Folded/);
  assert.equal(typeof processOutgoingPayload('{not-json}').error, 'string');
  const payloadResult = processOutgoingPayload({ messages }, { epochSize: 2, liveWindow: 2, charThreshold: 20, minLinesThreshold: 4 });
  assert.ok(payloadResult.savedBytes > 0);
  assert.ok(Number(payloadResult.savedPercent) > 0);
  assert.equal(processOutgoingPayload({ other: 123 }).savedBytes, 0);
});

test('guardrail detects repeats and only falls through from a 429 response', async () => {
  const guardrail = new GuardrailEngine({ maxConsecutiveLoops: 3, historyWindow: 5 });
  assert.equal(guardrail.evaluateToolCall('run', { cmd: 'test' }).isLoop, false);
  assert.equal(guardrail.evaluateToolCall('run', { cmd: 'test' }).isLoop, false);
  assert.equal(guardrail.evaluateToolCall('run', { cmd: 'test' }).isLoop, true);

  // Shift history window past capacity
  for (let i = 0; i < 10; i++) {
    guardrail.evaluateToolCall(`tool-${i}`, { idx: i });
  }
  assert.equal(guardrail.ringBuffer.length, 5);

  // Reset check
  guardrail.trackUsage(1000, 500);
  assert.ok(guardrail.sessionTotalTokens > 0);
  guardrail.reset();
  assert.equal(guardrail.ringBuffer.length, 0);
  assert.equal(guardrail.sessionTotalTokens, 0);

  let calls = 0;
  const response = await guardrail.executeWaterfall(async (tier) => { calls += 1; return { status: tier.status }; }, [{ status: 429 }, { status: 200 }]);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);

  // Failover on quota and ECONNREFUSED
  const failoverResp = await guardrail.executeWaterfall(async (tier) => {
    if (tier.err === 'quota') throw new Error('user quota exceeded');
    if (tier.err === 'conn') throw new Error('connect ECONNREFUSED 127.0.0.1');
    return { status: 200, tier: tier.name };
  }, [{ err: 'quota' }, { err: 'conn' }, { name: 'backup' }]);
  assert.equal(failoverResp.status, 200);
  assert.equal(failoverResp.tier, 'backup');

  // Exhaust all tiers
  await assert.rejects(
    () => guardrail.executeWaterfall(async () => { throw new Error('quota reached'); }, [{ name: 't1' }, { name: 't2' }]),
    /All waterfall tiers exhausted/
  );

  // Non-failover error
  await assert.rejects(() => guardrail.executeWaterfall(async () => { throw new Error('HTTP 400'); }, [{}]), /HTTP 400/);
  assert.equal(guardrail.trackUsage(150000, 0).hardCapped, true);
});

test('data lens handles empty datasets and non-financial log fallback', () => {
  const lens = new DataLens({ duckDbPath: null, clickHouseInfo: null, maxSampleSize: 1 });
  assert.match(lens.profileData(''), /Empty dataset/);
  assert.match(lens.collapseTearSheet(Array.from({ length: 31 }, (_, index) => `line ${index}`).join('\n')), /Collapsed/);
});

test('data lens handles delimited data without an external engine', () => {
  const lens = new DataLens({ duckDbPath: null, clickHouseInfo: null });
  const profile = lens.profileData('Date;Close\n2024-01-01;42,5\n2024-01-02;43,5');
  assert.match(profile, /DATA CONTRACT/);
  assert.match(profile, /Columns: 2/);
  assert.match(lens.collapseTearSheet('CAGR: +10%\nMax DD: -2%\nSharpe Ratio: 1.5'), /Return: \+10%/);
});

test('skill router keeps internal routes separate from harness routes', () => {
  const router = new SkillRouter({ autoIndex: true, skillDirs: [path.join(__dirname, '..', '..', 'skills')] });
  const internal = router.routeInternal('health check', { topK: 1 });
  assert.ok(internal.length > 0);
  assert.equal(internal[0].isInternal, true);
  assert.deepEqual(router.route('anything', { scope: 'invalid' }), []);
  assert.equal(new SkillRouter({ autoIndex: false, skillDirs: [] }).routeInternal('health').length, 0);
});
