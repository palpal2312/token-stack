const assert = require('assert');
const { foldMessages, processOutgoingPayload } = require('../core/turn-folder.cjs');

console.log("=== Testing Token-Stack Layer 7: Dynamic Turn Folding ===");

// 1. Generate a synthetic 20-turn conversation
const messages = [];
for (let i = 0; i < 20; i++) {
  if (i % 2 === 0) {
    // User or tool result
    if (i === 2 || i === 4 || i === 6) {
      // Big tool result (e.g. view_file 200 lines)
      const bigContent = Array.from({ length: 200 }, (_, idx) => `line ${idx + 1}: const item_${idx} = true;`).join('\n');
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `toolu_call_${i}`,
            content: bigContent
          }
        ]
      });
    } else if (i === 18) {
      // Tool result in LIVE WINDOW (should NOT be folded!)
      const liveBigContent = Array.from({ length: 200 }, (_, idx) => `recent_line ${idx + 1};`).join('\n');
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `toolu_call_${i}`,
            content: liveBigContent
          }
        ]
      });
    } else {
      messages.push({ role: 'user', content: `User turn ${i}` });
    }
  } else {
    // Assistant message
    messages.push({ role: 'assistant', content: `Assistant thinking and responding at turn ${i}` });
  }
}

// Test processOutgoingPayload
const result = processOutgoingPayload({ messages });
const foldedMsgs = result.payload.messages;

// Verification 1: Array length preserved
assert.strictEqual(foldedMsgs.length, 20, "Total message count must remain 20");

// Verification 2: Turn 2 (Cold epoch) MUST be folded
const turn2Content = foldedMsgs[2].content[0];
assert.strictEqual(turn2Content.tool_use_id, 'toolu_call_2', "tool_use_id must be preserved");
assert.strictEqual(turn2Content.type, 'tool_result', "type tool_result must be preserved");
assert(turn2Content.content.includes('Folded 192 lines by Token-Stack L7'), "Turn 2 should be folded");
assert(turn2Content.content.startsWith('line 1:'), "Turn 2 should preserve head lines");
assert(turn2Content.content.endsWith('line 200: const item_199 = true;'), "Turn 2 should preserve tail lines");

// Verification 3: Turn 18 (Live window) MUST NOT be folded
const turn18Content = foldedMsgs[18].content[0];
assert(!turn18Content.content.includes('Folded'), "Turn 18 is in live window and must NOT be folded");

// Verification 4: Byte / Token reduction
console.log(`Saved bytes: ${result.savedBytes} (${result.savedPercent}% reduction)`);
assert(result.savedPercent > 40, "Payload reduction should be >40%");

console.log("✔ ALL Phase 01 Turn-Folder Tests PASSED successfully!\n");
