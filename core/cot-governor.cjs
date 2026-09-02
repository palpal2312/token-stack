/**
 * Token-Stack 3.0: Layer 6 - Reasoning & CoT Budget Governor
 * Dynamically throttles extended thinking tokens (thinking.budget_tokens)
 * to prevent runaway thinking token burn on trivial coding turns.
 */

function evaluateThinkingBudget(turnText, fileCount = 1) {
  if (!turnText || typeof turnText !== 'string') {
    return 4096;
  }

  // Check for explicit user budget override in comment e.g. <!-- budget: 16000 -->
  const overrideMatch = turnText.match(/<!--\s*budget:\s*(\d+)\s*-->/i);
  if (overrideMatch) {
    return parseInt(overrideMatch[1], 10);
  }

  const text = turnText.toLowerCase();

  // High complexity triggers: architecture, refactoring, deep algorithmic bugs
  if (/architect|refactor|memory\s*leak|concurrency|race\s*condition|redesign|deadlock/i.test(text) || fileCount > 3) {
    return 8192;
  }

  // Low complexity triggers: typos, single-file renames, CSS styling, git commits, doc formatting
  if (/commit|format|typo|rename|css|style|clean|license|readme|docstring|lint/i.test(text) && fileCount <= 1) {
    return 1024;
  }

  // Default medium complexity
  return 4096;
}

/**
 * Modulates outgoing request body to apply dynamic thinking token caps.
 * @param {Object} payload - Outgoing Anthropic request payload
 * @returns {Object} { payload, modulated: boolean, assignedBudget: number|null }
 */
function modulateThinkingPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { payload, modulated: false, assignedBudget: null };
  }

  if (payload.thinking && payload.thinking.type === 'enabled') {
    // Extract last user message text to determine intent
    let lastUserText = '';
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      for (let i = payload.messages.length - 1; i >= 0; i--) {
        const m = payload.messages[i];
        if (m.role === 'user') {
          if (typeof m.content === 'string') {
            lastUserText = m.content;
            break;
          } else if (Array.isArray(m.content)) {
            lastUserText = m.content.map(b => b.text || '').join(' ');
            break;
          }
        }
      }
    }

    const budget = evaluateThinkingBudget(lastUserText);
    payload.thinking.budget_tokens = budget;

    // Ensure max_tokens accommodates budget_tokens
    const requiredMax = budget + 4096;
    if (!payload.max_tokens || payload.max_tokens < requiredMax) {
      payload.max_tokens = requiredMax;
    }

    return {
      payload,
      modulated: true,
      assignedBudget: budget
    };
  }

  return { payload, modulated: false, assignedBudget: null };
}

module.exports = {
  evaluateThinkingBudget,
  modulateThinkingPayload
};
