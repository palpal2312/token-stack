/**
 * Token-Stack 3.0: Layer -1 - Zero-Token Semantic Response Cache
 * Pure Node.js zero-dependency vector cosine similarity engine for instant 0-token answers.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold || 0.88;
    this.dbPath = options.dbPath || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.token-stack', 'semantic_cache.json');
    this.entries = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.entries = JSON.parse(data);
      }
    } catch (e) {
      this.entries = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.entries, null, 2), 'utf8');
    } catch (e) {}
  }

  /**
   * Tokenizes text into word tokens and character 3-grams to form a sparse frequency vector.
   */
  vectorize(text) {
    if (!text || typeof text !== 'string') return {};
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(w => w.length > 1);

    const vec = {};
    for (const w of words) {
      vec[w] = (vec[w] || 0) + 2; // Words weighted 2x
      // Generate char 3-grams for typo & morphological tolerance
      if (w.length >= 3) {
        for (let i = 0; i <= w.length - 3; i++) {
          const gram = w.slice(i, i + 3);
          vec[gram] = (vec[gram] || 0) + 1;
        }
      }
    }
    return vec;
  }

  cosineSimilarity(vecA, vecB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const key in vecA) {
      const valA = vecA[key];
      normA += valA * valA;
      if (vecB[key]) {
        dot += valA * vecB[key];
      }
    }

    for (const key in vecB) {
      normB += vecB[key] * vecB[key];
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  isSecret(text) {
    return /sk-[a-zA-Z0-9]{20,}|password\s*=|bearer\s+[a-zA-Z0-9_\-\.]+|secret/i.test(text);
  }

  /**
   * Finds a semantically similar cached response.
   * @param {string} prompt - User query text
   * @returns {Object|null} { hit: boolean, similarity: number, response: string }
   */
  find(prompt) {
    if (!prompt || this.isSecret(prompt)) return null;

    const queryVec = this.vectorize(prompt);
    let bestMatch = null;
    let highestSim = 0;

    for (const entry of this.entries) {
      const sim = this.cosineSimilarity(queryVec, entry.vec);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = entry;
      }
    }

    if (highestSim >= this.threshold && bestMatch) {
      bestMatch.hitCount = (bestMatch.hitCount || 0) + 1;
      this.save();
      return {
        hit: true,
        similarity: parseFloat(highestSim.toFixed(3)),
        response: bestMatch.response,
        model: bestMatch.model
      };
    }

    return null;
  }

  /**
   * Stores a prompt-response pair into the semantic cache.
   */
  store(prompt, response, model = "auto") {
    if (!prompt || !response || this.isSecret(prompt) || this.isSecret(response)) return;

    // Check if already exists with high similarity
    const existing = this.find(prompt);
    if (existing && existing.similarity >= 0.98) return;

    const vec = this.vectorize(prompt);
    this.entries.push({
      prompt,
      response,
      model,
      vec,
      hitCount: 0,
      createdAt: Date.now()
    });

    // Keep cache capped at 500 entries (LRU-like prune)
    if (this.entries.length > 500) {
      this.entries.shift();
    }

    this.save();
  }

  clear() {
    this.entries = [];
    this.save();
  }
}

module.exports = {
  SemanticCache,
  defaultCache: new SemanticCache()
};
