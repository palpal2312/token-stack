const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

const { withTempDir } = require('./helpers.cjs');
const { SemanticCache } = require('../../core/semantic-cache.cjs');
const { ModelRouter } = require('../../core/model-router.cjs');
const { evaluateThinkingBudget, modulateThinkingPayload } = require('../../core/cot-governor.cjs');
const { foldMessages, processOutgoingPayload } = require('../../core/turn-folder.cjs');
const { GuardrailEngine } = require('../../core/guardrail.cjs');
const { DataLens } = require('../../core/data-lens.cjs');
const { SkillRouter } = require('../../core/skill-router.cjs');

const {
  safeTextArb,
  nonBlankTextArb,
  promptArb,
  modelRouterOptionsArb,
  toolCallArb,
  conversationMessagesArb,
  thinkingPayloadArb,
  tabularDataArb
} = require('./arbitraries.cjs');

const numRuns = 500;

// 1. Semantic Cache: Cosine Symmetry and Range Invariant
test('PROPERTY [CACHE-SIMILARITY]: Cosine similarity is symmetric and bounded in [0, 1]', () => {
  const cache = new SemanticCache({ dbPath: null, autoLoad: false });
  fc.assert(
    fc.property(safeTextArb, safeTextArb, (textA, textB) => {
      const vecA = cache.vectorize(textA);
      const vecB = cache.vectorize(textB);
      const simAB = cache.cosineSimilarity(vecA, vecB);
      const simBA = cache.cosineSimilarity(vecB, vecA);

      // Symmetry
      assert.ok(Math.abs(simAB - simBA) < 1e-9, `Symmetry violation: ${simAB} vs ${simBA}`);
      // Range [0, 1]
      assert.ok(simAB >= 0 && simAB <= 1.000001, `Range violation: ${simAB}`);
    }),
    { numRuns }
  );
});

// 2. Semantic Cache: Capacity Cap Invariant
test('PROPERTY [CACHE-CAP]: SemanticCache never exceeds 500 entries regardless of insertions', async () => {
  await withTempDir('prop-cache-cap', (dir) => {
    const dbPath = path.join(dir, 'cache.json');
    const cache = new SemanticCache({ dbPath, threshold: 1 });
    fc.assert(
      fc.property(fc.array(nonBlankTextArb, { minLength: 1, maxLength: 50 }), (prompts) => {
        for (const p of prompts) {
          cache.store(p, `response-to-${p}`);
        }
        assert.ok(cache.stats().entriesCount <= 500, `Capacity exceeded: ${cache.stats().entriesCount}`);
      }),
      { numRuns: 100 }
    );
  });
});

// 3. Model Router: Determinism & Tier Validity Invariant
test('PROPERTY [MODEL-ROUTER]: Route produces deterministic valid tier and respects slash override', () => {
  fc.assert(
    fc.property(promptArb, modelRouterOptionsArb, (prompt, options) => {
      const router = new ModelRouter(options);
      const res1 = router.route(prompt);
      const res2 = router.route(prompt);

      // Determinism
      assert.equal(res1.selectedModel, res2.selectedModel);
      assert.equal(res1.tier, res2.tier);
      assert.ok(res1.tier === 'cheap' || res1.tier === 'flagship' || res1.tier === 'user_override');

      // Slash override precedence
      if (prompt.startsWith('/model ')) {
        const expectedModel = prompt.split(/\s+/)[1];
        if (expectedModel) {
          assert.equal(res1.selectedModel, expectedModel);
          assert.equal(res1.isOverride, true);
        }
      }
    }),
    { numRuns }
  );
});

// 4. Turn Folder: Idempotency and Non-Expansion Invariant
test('PROPERTY [FOLD-PRESERVE]: foldMessages is idempotent, non-expanding, and preserves live window', () => {
  fc.assert(
    fc.property(conversationMessagesArb, (messages) => {
      const folded1 = foldMessages(messages, { liveWindow: 4, epochSize: 5 });
      const folded2 = foldMessages(folded1, { liveWindow: 4, epochSize: 5 });

      // Idempotence
      assert.equal(folded1.length, folded2.length);
      assert.deepEqual(folded1, folded2);

      // Non-expanding message count
      assert.equal(folded1.length, messages.length);

      // Live window turns (last 4) are preserved verbatim
      const liveCount = Math.min(4, messages.length);
      const originalTail = messages.slice(-liveCount);
      const foldedTail = folded1.slice(-liveCount);
      assert.deepEqual(foldedTail, originalTail);
    }),
    { numRuns }
  );
});

// 5. CoT Governor: Finite Budget and Max Tokens Safety Invariant
test('PROPERTY [COT-BOUND]: Modulated payload assigns finite budget and preserves valid max_tokens', () => {
  fc.assert(
    fc.property(thinkingPayloadArb, (payload) => {
      const cloned = JSON.parse(JSON.stringify(payload));
      const result = modulateThinkingPayload(cloned);

      if (payload.thinking && payload.thinking.type === 'enabled') {
        assert.equal(result.modulated, true);
        assert.ok(Number.isInteger(result.assignedBudget));
        assert.ok(result.assignedBudget >= 1024);
        assert.ok(result.payload.max_tokens >= result.assignedBudget + 4096);
      } else {
        assert.equal(result.modulated, false);
        assert.equal(result.assignedBudget, null);
      }
    }),
    { numRuns }
  );
});

// 6. Guardrail: Monotonic Usage & Runaway Loop Detection
test('PROPERTY [GUARD-FAIL-CLOSED]: Loop detector triggers on 3 identical calls and usage is monotonic', () => {
  fc.assert(
    fc.property(toolCallArb, (call) => {
      const guardrail = new GuardrailEngine({ maxConsecutiveLoops: 3, historyWindow: 6 });
      
      // Step 1: 1st call -> not a loop
      const r1 = guardrail.evaluateToolCall(call.toolName, call.toolInput);
      assert.equal(r1.isLoop, false);

      // Step 2: 2nd call -> not a loop
      const r2 = guardrail.evaluateToolCall(call.toolName, call.toolInput);
      assert.equal(r2.isLoop, false);

      // Step 3: 3rd call -> detected loop
      const r3 = guardrail.evaluateToolCall(call.toolName, call.toolInput);
      assert.equal(r3.isLoop, true);
      assert.match(r3.intervention, /CIRCUIT BREAKER/);

      // Usage monotonicity
      const u1 = guardrail.trackUsage(100, 50);
      const u2 = guardrail.trackUsage(50, 20);
      assert.ok(u2.totalTokens > u1.totalTokens);
    }),
    { numRuns }
  );
});

// 7. Data Lens: Robustness on Arbitrary Tabular Strings
test('PROPERTY [DATA-LENS]: profileData never throws on arbitrary CSV input and extracts structure', () => {
  const lens = new DataLens({ maxSampleSize: 100 });
  fc.assert(
    fc.property(tabularDataArb, (csvText) => {
      const profile = lens.profileData(csvText);
      assert.ok(typeof profile === 'string');
      assert.ok(profile.length > 0);
    }),
    { numRuns: 200 }
  );
});

// 8. Skill Router: Scope Separation Invariant
test('PROPERTY [SKILL-ROUTER]: Internal routes return internal skills only', () => {
  const router = new SkillRouter({
    autoIndex: true,
    skillDirs: [path.join(__dirname, '..', '..', 'skills')]
  });

  fc.assert(
    fc.property(promptArb, (query) => {
      const internalSkills = router.routeInternal(query, { topK: 3 });
      for (const skill of internalSkills) {
        assert.equal(skill.isInternal, true, `Non-internal skill returned in routeInternal: ${skill.name}`);
        assert.ok(skill.score >= 0 && skill.score <= 1.000001);
      }
    }),
    { numRuns: 200 }
  );
});
