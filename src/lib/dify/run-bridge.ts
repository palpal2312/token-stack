import { randomUUID } from "node:crypto";
import { getProfile, getCurrentRevision } from "./profile-registry";
import { assertDifyEnabled } from "./enablement";
import { DifyClient } from "./client";
import { DifyStreamParser, parseDifyStream } from "./stream";
import { normalizeWorkflowInputs, getAgentOsUser } from "./inputs";
import { DifyOutputSpooler } from "./output-spool";
import { RunLedger } from "../llmops/ledger";
import { projectDifyLifecycle } from "./contracts";
import type { RunEnvelope, RunEvent } from "../llmops/contracts";

import fs from "node:fs/promises";
import path from "node:path";

export interface RunBridgeOptions {
  profileId: string;
  submissionId: string;
  inputs: Record<string, unknown>;
  stagedFiles?: string[];
  signal?: AbortSignal;
  ledger?: RunLedger;
}

export class DifyRunBridge {
  static async startRun(options: RunBridgeOptions): Promise<ReadableStream<Uint8Array>> {
    // Phase 1/2 enablement gate
    await assertDifyEnabled();

    const { profileId, submissionId, inputs, signal } = options;
    const runId = `dify-${profileId}-${submissionId}`;

    // Ensure ledger is available (or use a default one)
    const ledger = options.ledger || new RunLedger();

    const profile = await getProfile(profileId);
    if (!profile || profile.tombstone) {
      throw new Error(`Profile ${profileId} not found or deleted`);
    }

    const revision = await getCurrentRevision(profileId);
    if (!revision || !revision.validated) {
      throw new Error(`Profile ${profileId} has no validated revision`);
    }

    const user = getAgentOsUser(profileId);
    const now = new Date().toISOString();

    const runEnvelope: RunEnvelope = {
      schemaVersion: 1,
      runId,
      sourceRef: { kind: "kanban", id: submissionId }, // Stub, should probably come from options
      producerRef: { kind: "dify", id: profileId },
      status: "queued",
      createdAt: now,
    };

    // 1. Durably record intent (Run Queued)
    await ledger.append({
      id: randomUUID(),
      type: "run_queued",
      run: runEnvelope,
      at: now,
      redactionClass: "local-sensitive"
    });

    // 2. external_intent_recorded BEFORE outbound mutation
    await ledger.append({
      id: randomUUID(),
      type: "external_intent_recorded",
      run: runEnvelope,
      at: new Date().toISOString(),
      redactionClass: "local-sensitive",
      payload: {
        upstreamUser: user,
        submissionId
      }
    });

    // Set up NDJSON stream
    const enc = new TextEncoder();
    let isStreamOpen = true;
    let abortController = new AbortController();

    const client = new DifyClient({
      serviceApiBase: revision.baseUrl,
      apiKey: revision.apiKey
    });

    const combinedSignal = signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => {
          if (!isStreamOpen) return;
          try {
            controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          } catch {
            isStreamOpen = false;
          }
        };

        try {
          send({ t: "lifecycle", status: "queued", runId });
          send({ t: "lifecycle", status: "intent_recorded" });

          // 3. Upload staged files
          // (Stubbed for MVP as per design, we would upload to dify via client)

          // 4. Run workflow
          const runResponse = await client.runWorkflow(inputs, user, combinedSignal);

          if (!runResponse.body) {
             throw new Error("No response body to stream");
          }

          let workflowRunId: string | undefined = undefined;
          let hasReconciled = false;

          runEnvelope.status = "running";
          runEnvelope.startedAt = new Date().toISOString();

          await ledger.append({
             id: randomUUID(),
             type: "run_started",
             run: runEnvelope,
             at: runEnvelope.startedAt,
             redactionClass: "local-sensitive"
          });

          send({ t: "lifecycle", status: "running" });

          // 5. Stream events and project to ledger
          const difyStream = parseDifyStream(runResponse.body as unknown as ReadableStream<Uint8Array>);

          for await (const event of difyStream) {
              if (event.type === "lifecycle") {
                const newWorkflowRunId = event.event.workflowRunId;

                if (newWorkflowRunId && !hasReconciled) {
                    workflowRunId = newWorkflowRunId;
                    hasReconciled = true;
                    await ledger.append({
                        id: randomUUID(),
                        type: "external_intent_reconciled",
                        run: runEnvelope,
                        at: new Date().toISOString(),
                        redactionClass: "local-sensitive",
                        payload: {
                            workflowRunId,
                            taskId: event.event.taskId
                        }
                    });
                    send({ t: "correlation", workflowRunId });
                }

                const projection = projectDifyLifecycle(event.event.kind);

                if (projection.status !== runEnvelope.status) {
                    if (projection.status === "succeeded" || projection.status === "failed" || projection.status === "cancelled" || projection.status === "orphaned" || projection.status === "blocked") {
                        runEnvelope.status = projection.status;
                        runEnvelope.endedAt = new Date().toISOString();
                        const eventType = `run_${projection.status}` as any;

                        // 6. Handle output spool commit before terminal event
                        if (projection.terminal) {
                             // Output Spool Commit (Stubbed, we'd finalize reservation here)
                        }

                        await ledger.append({
                            id: randomUUID(),
                            type: eventType,
                            run: runEnvelope,
                            at: runEnvelope.endedAt!,
                            redactionClass: "local-sensitive"
                        });

                        send({ t: "lifecycle", status: projection.status });
                    }
                }
              }

              send(event);
          }

        } catch (error: any) {
          send({ t: "error", message: error.message });
          send({ t: "lifecycle", status: "failed" });

          if (runEnvelope.status !== "failed" && runEnvelope.status !== "cancelled" && runEnvelope.status !== "succeeded" && runEnvelope.status !== "orphaned") {
              runEnvelope.status = "failed";
              runEnvelope.endedAt = new Date().toISOString();
              await ledger.append({
                  id: randomUUID(),
                  type: "run_failed",
                  run: runEnvelope,
                  at: runEnvelope.endedAt,
                  redactionClass: "local-sensitive",
                  payload: {
                      error: error.message
                  }
              }).catch(() => {});
          }

        } finally {
          isStreamOpen = false;
          try { controller.close(); } catch {}
        }
      },
      cancel() {
        isStreamOpen = false;
        abortController.abort();
      }
    });

    return stream;
  }
}
