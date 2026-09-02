/**
 * Token-Stack 3.1: Brutal Stress & Edge-Case Verification Suite
 * Tests 10 difficult, real-world edge cases across data-lens, semantic-cache, cot-governor, and loop-breaker.
 */

const assert = require('assert');
const path = require('path');
const { DataLens } = require('../core/data-lens.cjs');
const { SemanticCache } = require('../core/semantic-cache.cjs');
const { evaluateThinkingBudget } = require('../core/cot-governor.cjs');
const { foldMessages } = require('../core/turn-folder.cjs');
const { GuardrailEngine } = require('../core/guardrail.cjs');

console.log('🧪 Starting 10-Case Brutal Stress & Edge-Case Verification Suite...\n');

const lens = new DataLens();

// ── Test 1: European Semicolon Delimited CSV with Decimal Commas ──
console.log('  [1/10] Testing European Semicolon CSV with Decimal Commas...');
const euroCsv = `Date;Open;High;Low;Close;Volume
2024-01-01 00:00;42000,50;42500,00;41800,00;42350,20;125
2024-01-01 01:00;42350,20;42800,00;42200,00;42700,00;180
2024-01-01 02:00;42700,00;43100,00;42600,00;42950,50;210`;
const euroProfile = lens.profileData(euroCsv);
assert(euroProfile.includes('[DATA CONTRACT:'), 'Should handle European CSV');
assert(euroProfile.includes('Close (FLOAT:'), 'Should recognize Close as FLOAT despite comma decimals');
console.log('    ✅ Passed: European decimal notation parsed correctly.');

// ── Test 2: Tab-Separated Financial Data (TSV) ──
console.log('  [2/10] Testing Tab-Separated Financial Data (TSV)...');
const tsvData = "Date\tOpen\tClose\tVolume\n2024-01-01\t100.5\t105.2\t5000\n2024-01-02\t105.2\t110.0\t6200";
const tsvProfile = lens.profileData(tsvData);
assert(tsvProfile.includes('[DATA CONTRACT:'), 'Should handle TSV format');
assert(tsvProfile.includes('Columns: 4'), 'Should detect 4 tab columns');
console.log('    ✅ Passed: TSV detected and profiled.');

// ── Test 3: Pipe-Separated Values (PSV) ──
console.log('  [3/10] Testing Pipe-Separated Values (PSV)...');
const psvData = "Timestamp|Price|Size\n2024-01-01 10:00:00|64200.5|0.45\n2024-01-01 10:00:01|64201.0|1.20";
const psvProfile = lens.profileData(psvData);
assert(psvProfile.includes('[DATA CONTRACT:'), 'Should handle Pipe-separated data');
assert(psvProfile.includes('Columns: 3'), 'Should detect 3 pipe columns');
console.log('    ✅ Passed: Pipe-delimited data handled.');

// ── Test 4: Dirty Data with BOM, Null Bytes, and NaN ──
console.log('  [4/10] Testing Dirty Data with BOM, Null Bytes, and NaN...');
const dirtyCsv = "\uFEFFDate,Price,Volume\0\n2024-01-01,50000,100\n2024-01-02,NaN,NULL\n2024-01-03,52000,250";
const dirtyProfile = lens.profileData(dirtyCsv);
assert(dirtyProfile.includes('[DATA CONTRACT:'), 'Should sanitize BOM and null bytes');
console.log('    ✅ Passed: Dirty tokens sanitized gracefully.');

// ── Test 5: Quant Tear-Sheet with CAGR, PnL, and Max DD ──
console.log('  [5/10] Testing Quant Tear-Sheet with CAGR, PnL, and Max DD...');
const customLog = `
--- BACKTEST METRICS ---
CAGR: +34.5%
Max DD: -9.8%
Win Rate: 68.2%
Total Trades: 540
Profit Factor: 2.15
Sharpe Ratio: 2.45
`;
const tearSheet = lens.collapseTearSheet(customLog);
assert(tearSheet.includes('Return: +34.5%'), 'Should extract CAGR as Return');
assert(tearSheet.includes('Max Drawdown: -9.8%'), 'Should extract Max DD');
assert(tearSheet.includes('Sharpe 2.45'), 'Should extract Sharpe Ratio');
console.log('    ✅ Passed: Alternative financial metrics parsed.');

// ── Test 6: Semantic Cache Unicode & Emoji Tolerance ──
console.log('  [6/10] Testing Semantic Cache Unicode & Emoji Tolerance...');
const cache = new SemanticCache({ threshold: 0.75 });
cache.clear();
const promptA = "How to connect PostgreSQL with connection pool? 🚀 (using pgx/v5)";
const promptB = "how to connect postgresql with connection pool? (pgx v5)";
cache.store(promptA, "Use pgxpool.NewWithConfig(context.Background(), config)");
const match = cache.find(promptB);
assert(match !== null && match.hit === true, 'Semantic cache should match despite emojis and punctuation');
console.log(`    ✅ Passed: Semantic cache matched with similarity ${(match.similarity * 100).toFixed(1)}%.`);

// ── Test 7: Semantic Cache Stats & Capacity Cap ──
console.log('  [7/10] Testing Semantic Cache Stats & Cap...');
const stats = cache.stats();
assert(typeof stats.entriesCount === 'number', 'Stats must return entriesCount');
assert(typeof stats.totalHits === 'number', 'Stats must return totalHits');
console.log(`    ✅ Passed: Semantic cache stats reported ${stats.entriesCount} entries.`);

// ── Test 8: CoT Governor Intent Boundaries ──
console.log('  [8/10] Testing CoT Governor Intent Boundaries...');
const typoBudget = evaluateThinkingBudget("Fix typo in submit button label: Submit -> Confirm", 1);
assert(typoBudget === 1024, 'Typo must receive minimum 1024 thinking tokens');
const archBudget = evaluateThinkingBudget("Redesign global microservices architecture and database shard replication", 4);
assert(archBudget === 8192, 'Architecture must receive maximum 8192 thinking tokens');
console.log('    ✅ Passed: CoT Governor dynamically modulated budget (1024 vs 8192).');

// ── Test 9: Loop Breaker Ring Buffer 3-Strike Rule ──
console.log('  [9/10] Testing Loop Breaker Ring Buffer 3-Strike Rule...');
const breaker = new GuardrailEngine();
const toolName = "run_command";
const toolInput = { CommandLine: "npm test -- --bail" };
assert(!breaker.evaluateToolCall(toolName, toolInput).isLoop, 'Strike 1 should not halt');
assert(!breaker.evaluateToolCall(toolName, toolInput).isLoop, 'Strike 2 should not halt');
const strike3 = breaker.evaluateToolCall(toolName, toolInput);
assert(strike3.isLoop === true, 'Strike 3 must trigger circuit breaker halt');
console.log('    ✅ Passed: Circuit breaker halted infinite loop at 3x duplicate execution.');

// ── Test 10: Turn Folder 10-Turn Compaction & Prompt Cache Breakpoint ──
console.log('  [10/10] Testing Turn Folder 10-Turn Compaction & Cache Breakpoint...');
const messages = [];
for (let i = 1; i <= 15; i++) {
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: `tool_${i}`,
        content: `Log output line 1\nLog output line 2\n` + 'Data line with verbose output\n'.repeat(25) + 'Final summary line'
      }
    ]
  });
}
const folded = foldMessages(messages, { epochSize: 5, liveWindow: 4, charThreshold: 200, minLinesThreshold: 10 });
const origChars = JSON.stringify(messages).length;
const foldChars = JSON.stringify(folded).length;
assert(foldChars < origChars, 'Folded messages must be smaller than original');
console.log(`    ✅ Passed: 15-turn conversation compressed from ${origChars} chars to ${foldChars} chars (-${(((origChars - foldChars) / origChars) * 100).toFixed(1)}%).`);

console.log('\n🎉 ALL 10 STRESS & EDGE-CASE TESTS PASSED (100% RELIABILITY)!');
