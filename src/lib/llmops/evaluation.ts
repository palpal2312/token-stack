import { type RunEnvelope } from "./contracts";
import { type AssetSnapshot } from "./assets";

export interface EvaluationResult {
  evaluatorId: string;
  passed: boolean;
  score?: number;
  reason?: string;
  executedAt: string;
}

export interface ReleasePolicy {
  id: string;
  requiredEvaluators: string[];
  minimumScore?: number;
}

export interface EvaluatorContext {
  run: RunEnvelope;
  asset: AssetSnapshot;
  artifacts: Array<{ path: string; content: string }>;
}

export type EvaluatorFunction = (ctx: EvaluatorContext) => Promise<EvaluationResult>;

export class EvaluationEngine {
  private evaluators = new Map<string, EvaluatorFunction>();
  private policies = new Map<string, ReleasePolicy>();

  registerEvaluator(id: string, fn: EvaluatorFunction): void {
    this.evaluators.set(id, fn);
  }

  registerPolicy(policy: ReleasePolicy): void {
    this.policies.set(policy.id, policy);
  }

  async evaluateRun(ctx: EvaluatorContext, policyId: string): Promise<{
    passed: boolean;
    results: EvaluationResult[];
  }> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    const results: EvaluationResult[] = [];
    let allPassed = true;

    for (const evalId of policy.requiredEvaluators) {
      const fn = this.evaluators.get(evalId);
      if (!fn) {
        throw new Error(`Evaluator ${evalId} not found`);
      }
      
      try {
        const res = await fn(ctx);
        results.push(res);
        if (!res.passed) allPassed = false;
        if (policy.minimumScore !== undefined && res.score !== undefined && res.score < policy.minimumScore) {
          allPassed = false;
        }
      } catch (e) {
        results.push({
          evaluatorId: evalId,
          passed: false,
          reason: `Evaluator crashed: ${String((e as Error)?.message ?? e)}`,
          executedAt: new Date().toISOString()
        });
        allPassed = false;
      }
    }

    return { passed: allPassed, results };
  }
}
