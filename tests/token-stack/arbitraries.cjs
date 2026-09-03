/**
 * Token-Stack Deep Adversarial Test Program: Bounded Fast-Check Arbitraries
 * Provides deterministic, bounded generators for testing core token-stack modules.
 */

const fc = require('fast-check');

// Bounded safe text generator (non-secret, mixed characters)
const safeTextArb = fc.string({ minLength: 0, maxLength: 500 });
const nonBlankTextArb = fc.string({ minLength: 1, maxLength: 300 }).filter(s => s.trim().length > 0);

// Arbitrary prompt generator
const promptArb = fc.oneof(
  fc.constant('Fix typo in README'),
  fc.constant('Design a distributed scheduler with high concurrency'),
  fc.constant('Write unit tests for authentication'),
  fc.constant('Format code and fix lint errors'),
  fc.constant('Investigate memory leak in production service'),
  fc.string({ minLength: 1, maxLength: 200 })
);

// Arbitrary model router options
const modelRouterOptionsArb = fc.record({
  filesCount: fc.integer({ min: 0, max: 20 }),
  defaultCheapModel: fc.oneof(fc.constant('claude-3-5-haiku-20241022'), fc.constant('deepseek-v3'), fc.constant('custom-cheap')),
  defaultFlagshipModel: fc.oneof(fc.constant('claude-3-7-sonnet-20250219'), fc.constant('claude-opus'), fc.constant('custom-flagship'))
});

// Tool call arbitrary for Guardrail testing
const toolCallArb = fc.record({
  toolName: fc.oneof(fc.constant('view_file'), fc.constant('run_command'), fc.constant('grep_search'), fc.string({ minLength: 1, maxLength: 20 })),
  toolInput: fc.oneof(
    fc.record({ path: fc.string({ minLength: 1, maxLength: 50 }), query: fc.string({ minLength: 0, maxLength: 50 }) }),
    fc.string({ minLength: 1, maxLength: 100 })
  )
});

// Turn Folder tool result block arbitrary
const toolResultBlockArb = fc.record({
  type: fc.constant('tool_result'),
  tool_use_id: fc.string({ minLength: 5, maxLength: 15 }),
  content: fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }), // small
    fc.array(fc.string({ minLength: 10, maxLength: 80 }), { minLength: 20, maxLength: 50 }).map(lines => lines.join('\n')), // large multi-line
    fc.constant('Error: command failed with code 1\nStack trace line 1\nline 2') // error
  ),
  is_error: fc.boolean()
});

// Turn Folder message arbitrary
const messageArb = fc.record({
  role: fc.oneof(fc.constant('user'), fc.constant('assistant')),
  content: fc.oneof(
    fc.string({ minLength: 1, maxLength: 500 }),
    fc.array(fc.oneof(
      fc.record({ type: fc.constant('text'), text: fc.string({ minLength: 1, maxLength: 200 }) }),
      toolResultBlockArb
    ), { minLength: 1, maxLength: 4 })
  )
});

// Array of conversation messages
const conversationMessagesArb = fc.array(messageArb, { minLength: 1, maxLength: 25 });

// CoT thinking payload arbitrary
const thinkingPayloadArb = fc.record({
  max_tokens: fc.integer({ min: 100, max: 32000 }),
  thinking: fc.record({
    type: fc.oneof(fc.constant('enabled'), fc.constant('disabled')),
    budget_tokens: fc.integer({ min: 512, max: 16384 })
  }),
  messages: fc.array(fc.record({
    role: fc.oneof(fc.constant('user'), fc.constant('assistant')),
    content: fc.string({ minLength: 1, maxLength: 200 })
  }), { minLength: 1, maxLength: 5 })
});

// Tabular data arbitrary for Data Lens
const tabularDataArb = fc.record({
  headers: fc.array(fc.string({ minLength: 1, maxLength: 15 }).filter(s => !s.includes(',') && !s.includes('\n')), { minLength: 2, maxLength: 5 }),
  rows: fc.array(fc.array(fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.float(), fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes(',') && !s.includes('\n'))), { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 20 })
}).map(({ headers, rows }) => {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.slice(0, headers.length).join(','));
  }
  return lines.join('\n');
});

module.exports = {
  safeTextArb,
  nonBlankTextArb,
  promptArb,
  modelRouterOptionsArb,
  toolCallArb,
  messageArb,
  conversationMessagesArb,
  thinkingPayloadArb,
  tabularDataArb
};
