export interface WorkflowStep {
  id: string;
  type: "tool" | "agent" | "condition" | "approval";
  action: string;
  args?: Record<string, unknown>;
  next?: string | Record<string, string>;
  retry?: {
    maxAttempts: number;
    delayMs: number;
  };
}

export interface WorkflowSchema {
  version: 1;
  id: string;
  name: string;
  startStep: string;
  steps: Record<string, WorkflowStep>;
}

export class WorkflowValidator {
  static validate(schema: any): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!schema || schema.version !== 1) errors.push("Invalid schema version");
    if (!schema.startStep || !schema.steps || !schema.steps[schema.startStep]) {
      errors.push("Missing or invalid startStep");
    }

    // Check cycles and missing refs
    const visited = new Set<string>();
    const stack = new Set<string>();

    function dfs(stepId: string) {
      if (stack.has(stepId)) {
        errors.push(`Cycle detected at step ${stepId}`);
        return;
      }
      if (visited.has(stepId)) return;
      
      const step = schema.steps[stepId];
      if (!step) {
        errors.push(`Missing reference to step ${stepId}`);
        return;
      }

      visited.add(stepId);
      stack.add(stepId);

      if (step.next) {
        if (typeof step.next === "string") {
          dfs(step.next);
        } else {
          for (const nextId of Object.values(step.next as Record<string, string>)) {
            dfs(nextId);
          }
        }
      }
      stack.delete(stepId);
    }

    if (schema.startStep && schema.steps[schema.startStep]) {
      dfs(schema.startStep);
    }

    return { ok: errors.length === 0, errors };
  }
}

import { JobQueue } from "./jobs";
import { randomUUID } from "node:crypto";

export class WorkflowCompiler {
  static async compile(schema: WorkflowSchema, queue: JobQueue, parentRunId: string): Promise<string[]> {
    const jobIds: string[] = [];
    // A real compiler would construct a DAG of jobs based on 'next' properties
    // For now, we compile sequential steps directly into the job queue.
    for (const [id, step] of Object.entries(schema.steps)) {
      const jobId = randomUUID();
      queue.enqueue(jobId, parentRunId, id);
      jobIds.push(jobId);
    }
    return jobIds;
  }
}
