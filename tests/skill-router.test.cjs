/**
 * Token-Stack: Layer 0.5 - Skill Router Unit Test Suite
 * Validates Two-Stage Retrieval, Anti-Skill-Shadowing, and Prompt Bloat Reduction.
 */

const assert = require('assert');
const path = require('path');
const { SkillRouter } = require('../core/skill-router.cjs');

console.log('🧪 Testing Token-Stack: Layer 0.5 - Dynamic Skill Router (Anti-Skill-Shadowing)...');

const router = new SkillRouter({ autoIndex: true });

console.log(`  Indexed ${router.skillsIndex.length} skills from local registries.`);
assert(router.skillsIndex.length > 0, 'Must successfully index at least 1 skill');

// ── Test 1: Git Workflow Intent Routing ──
console.log('  Testing Test 1: Git Workflow Intent Routing...');
const start1 = performance.now();
const gitRoute = router.route("I want to stage modified files and create a conventional commit then push PR", { topK: 2 });
const dur1 = performance.now() - start1;

console.log(`    Route Latency: ${dur1.toFixed(2)}ms`);
console.log(`    Selected Skills: ${gitRoute.map(s => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(', ')}`);

assert(gitRoute.length > 0, 'Should route to at least 1 git skill');
assert(gitRoute.some(s => s.name.includes('git')), 'Top routed skill should be git-related');
assert(dur1 < 30, 'Routing latency must be under 30ms');
console.log('  ✅ Test 1 Passed: Git workflow accurately routed.\n');

// ── Test 2: Benchmark Intent Routing ──
console.log('  Testing Test 2: Benchmark Intent Routing...');
const benchRoute = router.route("Run benchmark across 10 scenarios and calculate leave-one-out ablation", { topK: 2 });
console.log(`    Selected Skills: ${benchRoute.map(s => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(', ')}`);

assert(benchRoute.length > 0, 'Should route to benchmark skill');
assert(benchRoute.some(s => s.name.includes('benchmark')), 'Top skill should be token-stack-benchmark');
console.log('  ✅ Test 2 Passed: Benchmark intent accurately routed.\n');

// ── Test 3: Anti-Skill-Shadowing & Prompt Bloat Reduction ──
console.log('  Testing Test 3: Anti-Skill-Shadowing & Prompt Bloat Reduction...');
const rawBloatTokens = router.skillsIndex.length * 150; // Each skill definition takes ~150 tokens in system prompt
const activeBlock = router.generateActiveSkillContext(gitRoute);
const activeTokens = Math.ceil(activeBlock.length / 4);

console.log(`    Unfiltered Full Library Bloat: ~${rawBloatTokens.toLocaleString()} tokens (${router.skillsIndex.length} skills)`);
console.log(`    Active Dynamic Skill Block: ~${activeTokens} tokens (${gitRoute.length} skills)`);
console.log(`    System Prompt Reduction: -${(((rawBloatTokens - activeTokens) / rawBloatTokens) * 100).toFixed(1)}%`);

assert(activeTokens < 350, 'Active skill block must be under 350 tokens');
assert(activeBlock.includes('[TOKEN-STACK L0.5: ACTIVE SKILL ROUTER'), 'Must contain router header');
// ── Test 4: Dual-Scope Internal Routing (Token-Stack Sub-Skills) ──
console.log('  Testing Test 4: Dual-Scope Internal Routing...');
const internalRoute = router.routeInternal("token health check and daemon inspection", { topK: 1 });
console.log(`    Selected Internal Skill: ${internalRoute.map(s => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(', ')}`);
assert(internalRoute.length > 0, 'Internal route must return a skill');
assert(internalRoute[0].isInternal === true, 'Internal route must only return internal token-stack skills');
assert(internalRoute[0].name.includes('health'), 'Internal route should match health skill');
console.log('  ✅ Test 4 Passed: Internal Token-Stack sub-skill correctly isolated.\n');

// ── Test 5: Dual-Scope Global Harness Routing ──
console.log('  Testing Test 5: Dual-Scope Global Harness Routing...');
const harnessRoute = router.routeHarness("style frontend dashboard with tailwind css", { topK: 2 });
console.log(`    Selected Harness Skills: ${harnessRoute.map(s => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(', ')}`);
assert(harnessRoute.length > 0, 'Harness route must return skills');
assert(harnessRoute.every(s => s.isInternal === false), 'Harness route must only return harness skills');
assert(harnessRoute.some(s => s.name.includes('ui-styling') || s.name.includes('style')), 'Harness route should match UI styling skill');
console.log('  ✅ Test 5 Passed: Global Harness skills routed without internal pollution.\n');

console.log('🎉 ALL SKILL-ROUTER TESTS PASSED SUCCESSFULLY (100%)!');
