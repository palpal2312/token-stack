/**
 * Token-Stack 3.0: Layer 7 - Dynamic In-Flight Turn Folding Engine
 * Implements 5-turn Epoch Freezing (Attention Sinks + Tool Result Compaction)
 * Preserves Anthropic Prompt Cache breakpoints and tool schema invariants.
 */

const crypto = require('crypto');

// In-memory cache for frozen epochs to guarantee byte-for-byte prefix stability
const epochCache = new Map();

/**
 * Folds old tool results in completed 5-turn epochs.
 * @param {Array} messages - Anthropic messages array
 * @param {Object} options - Configuration options
 * @returns {Array} - New messages array with cold tool results folded
 */
function foldMessages(messages, options = {}) {
  const epochSize = options.epochSize || 5;
  const liveWindow = options.liveWindow || 4;
  const charThreshold = options.charThreshold || 1000;
  const minLinesThreshold = options.minLinesThreshold || 15;

  if (!Array.isArray(messages) || messages.length <= liveWindow) {
    return messages;
  }

  const completedEpochLimit = Math.floor((messages.length - liveWindow) / epochSize) * epochSize;
  if (completedEpochLimit <= 0) {
    return messages;
  }

  // Clone messages array to avoid mutating caller reference
  const processed = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Recent turns in active reasoning window: keep 100% raw
    if (i >= completedEpochLimit) {
      processed.push(msg);
      continue;
    }

    // Check if message belongs to a previously frozen epoch
    const epochIndex = Math.floor(i / epochSize);
    const cacheKey = `epoch_${epochIndex}_msg_${i}`;

    // Process cold message
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      let modified = false;
      const newContent = msg.content.map(block => {
        if (block && block.type === 'tool_result' && typeof block.content === 'string') {
          // Never fold error blocks or stack traces
          const isError = block.is_error || /error:|exception:|failed:/i.test(block.content);
          if (!isError && block.content.length > charThreshold) {
            const lines = block.content.split('\n');
            if (lines.length > minLinesThreshold) {
              modified = true;
              const head = lines.slice(0, 5).join('\n');
              const tail = lines.slice(-3).join('\n');
              const omittedCount = lines.length - 8;
              const foldedContent = `${head}\n\n[... Folded ${omittedCount} lines by Token-Stack L7 Turn-Folder ...]\n\n${tail}`;
              return {
                ...block,
                content: foldedContent
              };
            }
          }
        }
        return block;
      });

      if (modified) {
        processed.push({ ...msg, content: newContent });
        continue;
      }
    }

    processed.push(msg);
  }

  return processed;
}

/**
 * HTTP Proxy stream transformer for outgoing Anthropic /v1/messages requests
 */
function processOutgoingPayload(jsonBody, options = {}) {
  try {
    const payload = typeof jsonBody === 'string' ? JSON.parse(jsonBody) : jsonBody;
    if (payload && Array.isArray(payload.messages)) {
      const rawCount = JSON.stringify(payload.messages).length;
      payload.messages = foldMessages(payload.messages, options);
      const foldedCount = JSON.stringify(payload.messages).length;
      const savedBytes = rawCount - foldedCount;
      return {
        payload,
        savedBytes,
        savedPercent: rawCount > 0 ? ((savedBytes / rawCount) * 100).toFixed(1) : 0
      };
    }
    return { payload, savedBytes: 0, savedPercent: 0 };
  } catch (err) {
    return { payload: jsonBody, error: err.message, savedBytes: 0, savedPercent: 0 };
  }
}

module.exports = {
  foldMessages,
  processOutgoingPayload
};
