/**
 * Token-Stack 3.0: Layer 0 - Model Cascading & Frugal Router
 * Dynamically routes simple queries to cheap/fast models and deep tasks to flagship models.
 */

class ModelRouter {
  constructor(options = {}) {
    this.defaultFlagshipModel = options.defaultFlagshipModel || 'claude-3-7-sonnet-20250219';
    this.defaultCheapModel = options.defaultCheapModel || 'kimi-k3';
    this.costSavingsRatio = {
      'kimi-k3': 0.85,          // 85% cheaper than Sonnet
      'deepseek-v3': 0.90,      // 90% cheaper than Sonnet
      'qwen-2.5-coder': 0.88    // 88% cheaper than Sonnet
    };
  }

  /**
   * Evaluates prompt intent and determines appropriate model tier.
   * @param {string} promptText - User task instruction
   * @param {Object} context - Optional context (files touched, error logs)
   * @returns {Object} { tier: 'cheap'|'flagship', selectedModel: string, estimatedSavingsPercent: number, rationale: string }
   */
  route(promptText = '', context = {}) {
    if (!promptText || typeof promptText !== 'string') {
      return {
        tier: 'flagship',
        selectedModel: this.defaultFlagshipModel,
        isOverride: false,
        estimatedSavingsPercent: 0,
        rationale: 'Defaulting to flagship for undefined task'
      };
    }

    // 1. Explicit model override check (e.g. user typed /model sonnet or <!-- model: opus -->)
    const overrideMatch = promptText.match(/\/(model|use)\s+([a-zA-Z0-9_\-\.]+)/i) ||
                          promptText.match(/<!--\s*model:\s*([a-zA-Z0-9_\-\.]+)\s*-->/i);
    if (overrideMatch) {
      return {
        tier: 'user_override',
        selectedModel: overrideMatch[2],
        isOverride: true,
        estimatedSavingsPercent: 0,
        rationale: `User explicitly specified model '${overrideMatch[2]}'`
      };
    }

    const text = promptText.toLowerCase();
    const filesCount = context.filesCount || 1;

    // 2. High-complexity check -> Flagship Tier
    const isHighComplexity = (
      /architect|refactor|concurrency|race\s*condition|memory\s*leak|deadlock|system\s*design|redesign|audit/i.test(text) ||
      filesCount > 3 ||
      text.length > 2500
    );

    if (isHighComplexity) {
      return {
        tier: 'flagship',
        selectedModel: this.defaultFlagshipModel,
        isOverride: false,
        estimatedSavingsPercent: 0,
        rationale: 'Task requires deep architectural reasoning or multi-file context'
      };
    }

    // 3. Low-complexity check -> Cheap Tier
    const isLowComplexity = (
      /commit|format|typo|rename|css|style|clean|license|readme|docstring|lint|translate|regex|explain\s+var/i.test(text) &&
      filesCount <= 1
    );

    if (isLowComplexity) {
      const savings = Math.round((this.costSavingsRatio[this.defaultCheapModel] || 0.85) * 100);
      return {
        tier: 'cheap',
        selectedModel: this.defaultCheapModel,
        isOverride: false,
        estimatedSavingsPercent: savings,
        rationale: `Trivial task routed to fast tier (${this.defaultCheapModel}) saving ~${savings}% cost`
      };
    }

    // 4. Default: Standard Feature -> Flagship
    return {
      tier: 'flagship',
      selectedModel: this.defaultFlagshipModel,
      isOverride: false,
      estimatedSavingsPercent: 0,
      rationale: 'Standard implementation task routed to flagship model'
    };
  }
}

module.exports = {
  ModelRouter,
  defaultRouter: new ModelRouter()
};
