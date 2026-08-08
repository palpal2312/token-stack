import * as path from "node:path";
import { AGENTIC_HOME } from "./builders/registry";

/** Reject ids that would escape the runs directory or collide with path syntax. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Returns the directory where side files for a run (like transcript.md, artifacts/)
 * should be stored.
 *
 * Side files live in a folder named after the run, next to its state file.
 * The state file itself keeps its flat location so existing runs stay resumable.
 */
export function runDir(dir: string, runId: string): string {
  if (!RUN_ID.test(runId)) {
    throw new Error(`"${runId}" is not a run id. Run ids are letters, digits, dashes and underscores.`);
  }
  return path.join(dir, runId);
}

/**
 * Default runs directory.
 */
export const defaultRunsDir = path.join(AGENTIC_HOME, "runtime", "runs");
