# Token-Stack Mutation Testing Contract

## Purpose and Scope

Mutation testing ensures that the Token-Stack test suites do not merely execute code paths, but actively detect behavioral mutants and regressions.

### Target Surface

The mutation target is strictly the pure core modules in `core/*.cjs`:
1. `core/semantic-cache.cjs` (Critical Invariant: `CACHE-SECRET`)
2. `core/turn-folder.cjs` (Critical Invariant: `FOLD-PRESERVE`)
3. `core/cot-governor.cjs` (Critical Invariant: `COT-BOUND`)
4. `core/guardrail.cjs` (Critical Invariant: `GUARD-FAIL-CLOSED`)
5. `core/model-router.cjs`
6. `core/skill-router.cjs`
7. `core/data-lens.cjs`

### Exclusions & Rationales

- **`data-lens.cjs` Native Engine Detection**: External CLI child processes (`duckdb`, `clickhouse`) are disabled in test mode; mutating these detection branches causes extraneous non-functional timeouts.
- **Default Export Getters**: Lazy getter fallback instantiations (`get defaultCache()`, `get defaultRouter()`) are defensive initialization shims for global consumers; mutating their null-checks does not reflect core algorithmic logic.

## Thresholds & Quality Gates

| Metric | Target | Minimum Floor (Break) |
|---|---|---|
| Overall Core Mutation Score | ≥ 75.0% | 70.0% |
| Critical Invariants (`CACHE-SECRET`, `FOLD-PRESERVE`, `COT-BOUND`, `GUARD-FAIL-CLOSED`) | ≥ 80.0% | 75.0% |

## Survivor Classification Protocol

Every surviving mutant must be reviewed and classified into one of three dispositions:
1. **Missing Test**: Valid behavioral mutation that was not caught. A targeted test must be added to kill the mutant.
2. **Equivalent Mutant**: The mutant produces byte-identical or functionally indistinguishable output (e.g. `a >= b` vs `a > b - 1` with integers). Documented with rationale.
3. **Contract Revision**: The mutation revealed an unspecified or ambiguous edge case in the module contract. The contract and tests must be updated together.

## Execution & Artifacts

- Scheduled mutation runs execute nightly via `scripts/test-token-stack-mutation.ps1`.
- Machine-readable results are emitted to `reports/mutation/mutation-report.json`.
- Job timeout: 15 minutes max execution budget.
