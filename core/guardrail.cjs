/**
 * Token-Stack 3.0: Layer 8 - Runaway Loop Breaker & Smart Waterfall Failover
 * Detects circular agent loops (3x identical tool calls) and provides
 * transparent in-flight failover on HTTP 429 / Quota exhaustion.
 */

const crypto = require('crypto');

class GuardrailEngine {
  constructor(options = {}) {
    this.maxConsecutiveLoops = options.maxConsecutiveLoops || 3;
    this.historyWindow = options.historyWindow || 6;
    this.ringBuffer = [];
    this.sessionTotalTokens = 0;
    this.tokenBudgetWarning = options.tokenBudgetWarning || 50000;
    this.tokenBudgetHardCap = options.tokenBudgetHardCap || 150000;
  }

  reset() {
    this.ringBuffer = [];
    this.sessionTotalTokens = 0;
  }

  /**
   * Evaluates whether a tool call is part of an infinite repetitive loop.
   * @param {string} toolName - Name of the tool
   * @param {Object|string} toolInput - Tool arguments
   * @returns {Object} { isLoop: boolean, intervention: string|null }
   */
  evaluateToolCall(toolName, toolInput) {
    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {});
    const hash = crypto.createHash('sha256').update(`${toolName}:${inputStr}`).digest('hex');

    this.ringBuffer.push(hash);
    if (this.ringBuffer.length > this.historyWindow) {
      this.ringBuffer.shift();
    }

    // Check if the last N actions are identical
    if (this.ringBuffer.length >= this.maxConsecutiveLoops) {
      const recentSlice = this.ringBuffer.slice(-this.maxConsecutiveLoops);
      const allIdentical = recentSlice.every(h => h === hash);
      if (allIdentical) {
        return {
          isLoop: true,
          intervention: `[CIRCUIT BREAKER: Action '${toolName}' has been executed ${this.maxConsecutiveLoops} consecutive times with identical inputs and no progress. Execution halted by Token-Stack Guardrail to prevent runaway token spend. Formulate an alternate approach, read surrounding files, or ask the user.]`
        };
      }
    }

    return { isLoop: false, intervention: null };
  }

  /**
   * Tracks token usage and triggers budget alerts.
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @returns {Object} { warning: boolean, hardCapped: boolean }
   */
  trackUsage(inputTokens = 0, outputTokens = 0) {
    this.sessionTotalTokens += (inputTokens + outputTokens);
    return {
      totalTokens: this.sessionTotalTokens,
      warning: this.sessionTotalTokens >= this.tokenBudgetWarning,
      hardCapped: this.sessionTotalTokens >= this.tokenBudgetHardCap
    };
  }

  /**
   * Transparent Waterfall Failover Runner.
   * Replays an in-flight HTTP request across provider tiers if 429/quota error is returned.
   * @param {Function} dispatchFn - Async function taking a provider config and returning an HTTP response
   * @param {Array} providerTiers - Array of provider configurations
   * @returns {Promise<Object>} - Successful response or throws error if all tiers fail
   */
  async executeWaterfall(dispatchFn, providerTiers = []) {
    let lastError = null;

    for (let i = 0; i < providerTiers.length; i++) {
      const provider = providerTiers[i];
      try {
        const resp = await dispatchFn(provider);
        // Check for rate limit or allocation exhaustion
        if (resp && (resp.status === 429 || resp.status === 503)) {
          lastError = new Error(`Provider '${provider.name || i}' returned HTTP ${resp.status} (${resp.statusText || 'Rate limit / Quota'})`);
          continue; // Try next tier
        }
        return resp; // Success
      } catch (err) {
        lastError = err;
        // If network error or 429 error, continue to next provider
        if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('ECONNREFUSED'))) {
          continue;
        }
        throw err; // Non-failover error (e.g. invalid syntax 400)
      }
    }

    throw new Error(`All waterfall tiers exhausted. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  }
}

module.exports = {
  GuardrailEngine,
  defaultEngine: new GuardrailEngine()
};
