// The transcript: a run, rendered for a human to read while it is still
// happening.
//
// The state file is the machine's truth — every message, every revision. It
// is also unreadable at a glance. The transcript is the same trace rewritten
// as a plain markdown narrative: what the user asked, what the brain said,
// which tools ran with what, how it ended. It exists so a run can be
// reviewed without a UI, and so a crash mid-run still leaves a story.
//
// It is re-rendered whole after every step and swapped in with the same
// tmp-file-plus-rename pattern as the state file, so a reader mid-write sees
// either the previous step's transcript or the new one — never half of one.

import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { RunState, RunStep } from "./state";

/** Tool results get clipped so one chatty tool cannot drown the narrative. */
const RESULT_CAP = 500;
const ARGS_CAP = 200;

function clip(value: unknown, cap: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > cap ? `${text.slice(0, cap)}… [+${text.length - cap} chars]` : text;
}

function renderStep(step: RunStep, lines: string[]): void {
  switch (step.kind) {
    case "input":
      lines.push("## Input", "", step.text ?? "", "");
      break;
    case "brain": {
      lines.push(`## Turn ${step.turn ?? "?"} — the brain`, "");
      if (step.text) lines.push(step.text, "");
      for (const call of step.toolCalls ?? []) {
        lines.push(`→ asked for \`${call.name}\` (${clip(call.arguments, ARGS_CAP)})`);
      }
      if (step.toolCalls?.length) lines.push("");
      break;
    }
    case "tool": {
      const verdict = step.error ? "error" : "ok";
      lines.push(`### \`${step.name}\` — ${verdict} (${step.decision ?? "?"})`, "");
      lines.push(`- args: ${clip(step.args, ARGS_CAP)}`);
      lines.push(`- result: ${clip(step.result, RESULT_CAP)}`, "");
      break;
    }
    case "finish":
      lines.push(`## Finish — ${step.name}`, "");
      if (step.text) lines.push(step.text, "");
      break;
  }
}

export function renderTranscript(state: RunState): string {
  const lines: string[] = [
    `# Run ${state.id}`,
    "",
    `- Agent: ${state.agentName}`,
    `- Thread: ${state.threadId}`,
    `- Status: ${state.status}`,
    `- Started: ${state.createdAt}`,
    `- Updated: ${state.updatedAt}`,
    "",
  ];

  if (state.pendingApproval) {
    lines.push(
      `> Parked on \`${state.pendingApproval.tool}\` — resume with approve or deny.`,
      "",
    );
  }

  for (const step of state.steps) renderStep(step, lines);

  if (state.artifacts.length) {
    lines.push("## Artifacts", "");
    for (const a of state.artifacts) lines.push(`- \`${a.path}\` (${a.kind}, ${a.createdAt})`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Rewrite the run's transcript.md atomically. Creates the run directory. */
export async function writeTranscript(runDir: string, state: RunState): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "transcript.md");
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, renderTranscript(state), "utf8");
  try {
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}
