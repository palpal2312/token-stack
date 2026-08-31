// Latency / loss / duplicate evidence runner (S03-L3-003).
//
// Exercises the REAL Lane 2 reconnect logic (mergeEventsBySeq, hasEventGap
// from src/lib/sen/chat-client.ts) against injected duplicate, loss and
// reorder streams, and measures latency distributions. Fixture-level: no
// network, no model tokens, deterministic. Covers matrix cells FI-04/FI-05.
//
// Run: npx tsx qa/fixtures/sprint03/event-evidence-runner.ts [--json out.json]
// Exit 0 = every scenario passed.

import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { mergeEventsBySeq, hasEventGap, type ChatStreamEvent } from "../../../src/lib/sen/chat-client";

function ev(seq: number, attempt = "a-fixture"): ChatStreamEvent {
  return { chatAttemptId: attempt, seq, eventKind: "delta", payload: { text: `e${seq}` }, redactionClass: "none", recordedAt: "2026-08-25T00:00:00Z" };
}
function stream(from: number, to: number): ChatStreamEvent[] {
  const out: ChatStreamEvent[] = [];
  for (let s = from; s <= to; s++) out.push(ev(s));
  return out;
}

interface Scenario { id: string; passed: boolean; detail: string }

function scenarioDuplicateTail(): Scenario {
  // FI-04: reconnect refetches an overlapping tail; merged view must dedupe.
  const applied = new Map<number, ChatStreamEvent>();
  mergeEventsBySeq(applied, stream(1, 100));
  const refetchedTail = stream(81, 140); // 20-seq overlap
  const merged = mergeEventsBySeq(applied, refetchedTail);
  const seqs = merged.map((e) => e.seq);
  const unique = new Set(seqs).size === seqs.length;
  const ordered = seqs.every((s, i) => i === 0 || seqs[i - 1] < s);
  const complete = seqs.length === 140 && seqs[0] === 1 && seqs[139] === 140;
  const passed = unique && ordered && complete;
  return { id: "FI-04-duplicate-tail-dedupe", passed, detail: `merged=${seqs.length} unique=${unique} ordered=${ordered} complete=${complete}` };
}

function scenarioLossAndRefetch(): Scenario {
  // FI-05: one middle event lost in delivery; gap detected; refetch from
  // after_seq restores continuity and the gap clears.
  const delivered = stream(1, 100).filter((e) => e.seq !== 57);
  const applied = new Map<number, ChatStreamEvent>();
  mergeEventsBySeq(applied, delivered);
  const gapSeen = hasEventGap(56, delivered.filter((e) => e.seq > 56));
  // client refetches from the gap point (after_seq=56)
  const repair = stream(57, 100);
  const repaired = mergeEventsBySeq(applied, repair);
  const gapAfter = hasEventGap(56, repaired.filter((e) => e.seq > 56));
  const full = repaired.length === 100;
  const passed = gapSeen && !gapAfter && full;
  return { id: "FI-05-loss-gap-refetch", passed, detail: `gapDetected=${gapSeen} gapAfterRefetch=${gapAfter} finalEvents=${repaired.length}/100` };
}

function scenarioReorder(): Scenario {
  const applied = new Map<number, ChatStreamEvent>();
  const batch = stream(1, 50);
  // deliver odd/even halves out of order (buffered reorder on reconnect)
  const reordered = [...batch.filter((e) => e.seq % 2 === 1), ...batch.filter((e) => e.seq % 2 === 0)];
  const merged = mergeEventsBySeq(applied, reordered);
  const seqs = merged.map((e) => e.seq);
  const ordered = seqs.every((s, i) => i === 0 || seqs[i - 1] < s);
  return { id: "reorder-sorted-merge", passed: ordered && merged.length === 50, detail: `merged=${merged.length} ordered=${ordered}` };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function scenarioLatency() {
  // Cold-merge latency: build a fresh applied-map per round from a full stream.
  const runs: { n: number; p50: number; p95: number; max: number }[] = [];
  for (const n of [1_000, 10_000, 50_000]) {
    const source = stream(1, n);
    const samples: number[] = [];
    for (let r = 0; r < 7; r++) {
      const applied = new Map<number, ChatStreamEvent>();
      const t0 = performance.now();
      mergeEventsBySeq(applied, source);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    runs.push({ n, p50: +percentile(samples, 50).toFixed(2), p95: +percentile(samples, 95).toFixed(2), max: +samples[samples.length - 1].toFixed(2) });
  }
  // Incremental tail-merge latency (the reconnect hot path): 10k applied, 200 new.
  const base = new Map<number, ChatStreamEvent>();
  mergeEventsBySeq(base, stream(1, 10_000));
  const tail = stream(9_801, 10_200);
  const samples: number[] = [];
  for (let r = 0; r < 7; r++) {
    const applied = new Map(base);
    const t0 = performance.now();
    mergeEventsBySeq(applied, tail);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { id: "latency", passed: true, coldMergeMs: runs, tailMergeMs: { appliedBase: 10_000, incoming: 400, p50: +percentile(samples, 50).toFixed(2), p95: +percentile(samples, 95).toFixed(2) } };
}

const outIdx = process.argv.indexOf("--json");
const scenarios: Scenario[] = [scenarioDuplicateTail(), scenarioLossAndRefetch(), scenarioReorder()];
const latency = scenarioLatency();
const failed = scenarios.filter((s) => !s.passed).length;
const evidence = {
  runner: "event-evidence-runner.ts",
  ranAt: new Date().toISOString(),
  exercises: "real Lane 2 mergeEventsBySeq/hasEventGap (src/lib/sen/chat-client.ts)",
  scenarios,
  latency,
  passed: scenarios.length - failed,
  failed,
};
const text = JSON.stringify(evidence, null, 2);
if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], text + "\n", "utf8");
// compact counter line for token-free observers
console.log(`S03-L3-003: ${evidence.passed}/${scenarios.length} scenarios pass | tail-merge p50=${latency.tailMergeMs.p50}ms | cold-10k p50=${latency.coldMergeMs[1].p50}ms`);
if (outIdx < 0) console.log(text);
process.exit(failed === 0 ? 0 : 1);
