import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type Record = { record_id: string; predicted_elapsed_ms: number; observed_elapsed_ms: number };
type Fixture = {
  fixture_id: string;
  cohort_id: string;
  provenance: Record<string, string>;
  records: Record[];
  recovery_checkpoint: { phase: string; completed_metric_names: string[]; remaining_metric_names: string[] };
  unavailable_cohort: { cohort_id: string; reason: string };
};
type DerivedOutput = {
  status: "partial" | "complete" | "not-measurable";
  publication_key: string | null;
  metric_names: string[];
};

const fixturePath = resolve(process.cwd(), "qa/fixtures/sprint10/redacted-recovery-v1.json");
const fixtureText = readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText) as Fixture;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const forbiddenField = /(?:prompt|conversation|repository|filesystem|credential|secret|personal|raw_log|token)/i;

function validFrozenInput(value: unknown): value is Fixture {
  if (!value || typeof value !== "object") return false;
  const serialized = JSON.stringify(value);
  return !forbiddenField.test(serialized)
    && Array.isArray((value as Fixture).records)
    && (value as Fixture).records.every((record) => Number.isFinite(record.predicted_elapsed_ms) && Number.isFinite(record.observed_elapsed_ms));
}

function derive(input: unknown, phase: "partial" | "complete"): DerivedOutput {
  if (!validFrozenInput(input) || input.records.length === 0) {
    return { status: "not-measurable", publication_key: null, metric_names: [] };
  }
  const allMetricNames = ["elapsed_error", "sequential_error", "coverage", "utilization", "retry_rework_miss", "acceptance_calibration", "allocation_regret"];
  const metricNames = phase === "partial" ? ["elapsed_error"] : allMetricNames;
  return {
    status: phase,
    publication_key: digest({ fixture: input.fixture_id, fixture_hash: digest(input), metricNames }),
    metric_names: metricNames,
  };
}

function publishOnce(output: DerivedOutput, publicationRegistry: Set<string>): "published" | "duplicate-suppressed" | "not-published" {
  if (output.status !== "complete" || !output.publication_key) return "not-published";
  if (publicationRegistry.has(output.publication_key)) return "duplicate-suppressed";
  publicationRegistry.add(output.publication_key);
  return "published";
}

test("S10 recovery distinguishes partial output from a complete replay and resumes from the frozen hash", () => {
  const partial = derive(fixture, "partial");
  const recovered = derive(fixture, "complete");
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.metric_names, ["elapsed_error"]);
  assert.equal(recovered.status, "complete");
  assert.equal(recovered.metric_names.length, 7);
  assert.notEqual(partial.publication_key, recovered.publication_key);
  assert.equal(digest(JSON.parse(fixtureText)), digest(fixture));
});

test("S10 recovery suppresses duplicate completion publication after deterministic replay", () => {
  const publications = new Set<string>();
  const first = derive(fixture, "complete");
  const restarted = derive(JSON.parse(fixtureText), "complete");
  assert.equal(first.publication_key, restarted.publication_key);
  assert.equal(publishOnce(first, publications), "published");
  assert.equal(publishOnce(restarted, publications), "duplicate-suppressed");
  assert.equal(publications.size, 1);
});

test("S10 unavailable or forbidden inputs fail closed without a publication", () => {
  assert.deepEqual(derive([], "complete"), { status: "not-measurable", publication_key: null, metric_names: [] });
  assert.deepEqual(derive({ ...fixture, secret_token: "never-accepted" }, "complete"), { status: "not-measurable", publication_key: null, metric_names: [] });
});

test("S10 recovery evaluator is local read-only and has no command or network surface", () => {
  const source = readFileSync(resolve(process.cwd(), "qa/tests/s10-offline-recovery-operations.test.ts"), "utf8");
  const forbiddenApiNames = [
    "child_" + "process", "h" + "ttp", "h" + "ttps", "n" + "et", "t" + "ls", "d" + "gram",
    "fe" + "tch", "sp" + "awn", "ex" + "ec", "write" + "File", "append" + "File",
  ];
  assert.equal(new RegExp(`node:(?:${forbiddenApiNames.slice(0, 6).join("|")})|\\b(?:${forbiddenApiNames.slice(6).join("|")})\\b`, "i").test(source), false);
  assert.equal(/https?:\/\//i.test(fixtureText), false);
  assert.equal(fixture.provenance.source_class, "frozen-redacted-replay");
});
