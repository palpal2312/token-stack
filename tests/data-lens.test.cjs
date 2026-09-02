const { DataLens } = require('../core/data-lens.cjs');
const assert = require('assert');

console.log('🧪 Testing Token-Stack: Layer 1.5 - Data & Quant Topology (Data Lens)...');

const lens = new DataLens();

// ── Test 1: OHLCV Financial CSV Profiling ──
console.log('  Testing Test 1: Financial OHLCV CSV Profiling...');

// Generate 500 lines of mock BTCUSDT OHLCV data
const header = 'Date,Open,High,Low,Close,Volume\n';
let csvContent = header;
let currentPrice = 60000;
for (let i = 0; i < 500; i++) {
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(i / 24), i % 24)).toISOString();
  const open = currentPrice;
  const high = open + Math.random() * 500;
  const low = open - Math.random() * 500;
  const close = low + Math.random() * (high - low);
  const volume = (Math.random() * 100).toFixed(2);
  currentPrice = close;
  csvContent += `${d},${open.toFixed(1)},${high.toFixed(1)},${low.toFixed(1)},${close.toFixed(1)},${volume}\n`;
}

const rawTokensEstimate = Math.ceil(csvContent.length / 4);
const profile = lens.profileData(csvContent);
const profileTokensEstimate = Math.ceil(profile.length / 4);

console.log(`    Raw CSV Tokens: ~${rawTokensEstimate} | Data Contract Tokens: ~${profileTokensEstimate}`);
console.log(`    Token Reduction: -${(((rawTokensEstimate - profileTokensEstimate) / rawTokensEstimate) * 100).toFixed(1)}%`);

assert(profile.includes('[DATA CONTRACT:'), 'Profile should contain DATA CONTRACT header');
assert(profile.includes('Time Coverage:'), 'Profile should extract time coverage');
assert(profile.includes('Close (FLOAT:'), 'Profile should extract numeric bounds for Close');
assert(profileTokensEstimate < 200, 'Profile must be compact (<200 tokens)');

console.log('  ✅ Test 1 Passed: OHLCV CSV successfully converted to compact Data Contract!\n');

// ── Test 2: Backtest Tear-Sheet Collapsing ──
console.log('  Testing Test 2: Quant Backtest Log Tear-Sheet Collapsing...');

let verboseLog = '=== STARTING BACKTEST SIMULATION (10,000 BARS) ===\n';
for (let i = 1; i <= 200; i++) {
  verboseLog += `[ORDER #${i}] FILLED BUY 0.5 BTC @ $61,240.50 | Fee: $12.24 | Slippage: $1.10\n`;
  verboseLog += `[ORDER #${i}] FILLED SELL 0.5 BTC @ $62,100.00 | Realized PnL: +$429.75\n`;
}
verboseLog += `
=========================================
          BACKTEST PERFORMANCE
=========================================
Start                     2024-01-01
End                       2024-12-31
Duration                   365 days
Exposure Time [%]             64.20
Equity Final [$]          148,250.00
Return [%]                   +48.25
Buy & Hold Return [%]        +32.10
Return (Ann.) [%]            +48.25
Volatility (Ann.) [%]         22.10
Sharpe Ratio                   2.18
Sortino Ratio                  3.40
Calmar Ratio                   3.39
Max. Drawdown [%]            -14.20
Avg. Drawdown [%]             -2.80
# Trades                        400
Win Rate [%]                  62.50
Best Trade [%]                +8.40
Worst Trade [%]               -3.10
Avg. Trade [%]                +1.20
Profit Factor                  1.85
Expectancy [%]                +0.95
SQN                            4.20
Kelly Criterion                0.24
=========================================
`;

const rawLogTokens = Math.ceil(verboseLog.length / 4);
const tearSheet = lens.collapseTearSheet(verboseLog);
const tearSheetTokens = Math.ceil(tearSheet.length / 4);

console.log(`    Raw Log Tokens: ~${rawLogTokens} | Tear-Sheet Tokens: ~${tearSheetTokens}`);
console.log(`    Tear-Sheet Token Reduction: -${(((rawLogTokens - tearSheetTokens) / rawLogTokens) * 100).toFixed(1)}%`);

assert(tearSheet.includes('[QUANT PERFORMANCE TEAR-SHEET]'), 'Should produce QUANT PERFORMANCE TEAR-SHEET');
assert(tearSheet.includes('Return: +48.25'), 'Should parse Return %');
assert(tearSheet.includes('Sharpe 2.18'), 'Should parse Sharpe Ratio');
assert(tearSheet.includes('Max Drawdown: -14.20'), 'Should parse Max Drawdown');
assert(tearSheet.includes('Win Rate: 62.50'), 'Should parse Win Rate');
assert(tearSheetTokens < 120, 'Tear-sheet must be under 120 tokens');

console.log('  ✅ Test 2 Passed: 400+ trade log lines collapsed into 4-line Tear-Sheet!\n');

console.log('🎉 ALL DATA-LENS TESTS PASSED SUCCESSFULLY (100%)!');
