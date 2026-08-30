import { NextResponse } from "next/server";
import { herdrSnapshotRead } from "@/lib/herdr";
import { listBuilders, RegistryCorrupt } from "@/lib/builders/registry";
import { allClis } from "@/lib/builders/clis";
import {
  readRuntimeProjection,
  readCodeSpaceSummary,
  readSandboxWorkers,
  type GoRuntimeAttempt,
  type GoCodeSpaceSummary,
  type GoSandboxWorker,
} from "@/lib/agentRuntime/go-builder-exec-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RuntimeProjectionRead {
  attempts: GoRuntimeAttempt[];
  error: string | null;
}

async function runtimeProjectionRead(enabled: boolean): Promise<RuntimeProjectionRead> {
  if (!enabled) return { attempts: [], error: null };
  try {
    const projection = await readRuntimeProjection();
    return { attempts: projection.attempts, error: null };
  } catch (error) {
    return {
      attempts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface CodeSpaceSummaryRead {
  summaries: GoCodeSpaceSummary[];
  projectionVersion: string | null;
  error: string | null;
}

interface SandboxWorkerRead {
  workers: GoSandboxWorker[];
  error: string | null;
}

async function sandboxWorkerRead(): Promise<SandboxWorkerRead> {
  try {
    return { workers: (await readSandboxWorkers()).workers, error: null };
  } catch (error) {
    return { workers: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function codespaceSummaryRead(enabled: boolean): Promise<CodeSpaceSummaryRead> {
  if (!enabled) return { summaries: [], projectionVersion: null, error: null };
  try {
    const summary = await readCodeSpaceSummary();
    return { summaries: summary.summaries, projectionVersion: summary.projection_version, error: null };
  } catch (error) {
    return {
      summaries: [],
      projectionVersion: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Code Space's combined read: direct Herdr data remains attach/transport state,
 * while canonical Attempt lifecycle comes from the Go runtime projection.
 *
 * Projection is read whenever the daemon is up, regardless of write-authority
 * flag state. This preserves projection visibility during flag-off rollback.
 *
 * The Herdr snapshot itself goes through herdrSnapshotRead: with
 * SEN_GO_HERDR_SNAPSHOT_CACHE=1 it is served from the sen-daemon cache (one
 * spawn per TTL instead of one per request) with legacy spawn fallback;
 * flag-off is the byte-identical legacy path.
 */
export async function GET() {
  const runtimeProjectionEnabled = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1";
  const codespaceSummaryEnabled = process.env.SEN_GO_CODESPACE_SUMMARY === "1";
  const sandboxWorkersEnabled = process.env.SEN_GO_SANDBOX_WORKERS === "1";
  // Concurrently fetch Herdr snapshot and existing runtime projections.
  const [read, projected, codespace, workers] = await Promise.all([
    herdrSnapshotRead(),
    runtimeProjectionRead(true),
    codespaceSummaryRead(codespaceSummaryEnabled),
    sandboxWorkersEnabled ? sandboxWorkerRead() : Promise.resolve({ workers: [], error: null } as SandboxWorkerRead),
  ]);
  const workerMeta = sandboxWorkersEnabled
    ? { sandboxWorkers: workers.workers, sandboxWorkersError: workers.error }
    : {};
  const snap = read.snap;

  const status = read.status ?? {
    installed: true,
    bin: null,
    version: null,
    running: snap.ok,
    error: snap.ok ? null : (snap.error ?? "Herdr server is not running."),
  };

  // Additive staleness signaling for the UI badge — only on the daemon-cache
  // path, so the legacy flag-off response stays byte-identical.
  const snapshotMeta =
    read.source === "daemon-cache"
      ? {
          snapshotGeneratedAt: read.generatedAt,
          snapshotStale: read.stale,
          snapshotSource: read.source,
        }
      : {};

  // Additive codespace summary fields — only with SEN_GO_CODESPACE_SUMMARY=1,
  // so the legacy flag-off response stays byte-identical.
  const summaryMeta = codespaceSummaryEnabled
    ? {
        codespaceSummary: codespace.error
          ? null
          : {
              projection_version: codespace.projectionVersion,
              summaries: codespace.summaries,
            },
        codespaceSummaryError: codespace.error,
      }
    : {};
  if (!snap.ok || !snap.data) {
    return NextResponse.json({
      status,
      snapshot: null,
      builders: [],
      clis: [],
      runtimeProjectionEnabled,
      runtimeAttempts: projected.attempts,
      runtimeProjectionError: projected.error,
      ...snapshotMeta,
      ...summaryMeta,
      ...workerMeta,
    });
  }

  let builders: Awaited<ReturnType<typeof listBuilders>> = [];
  let registryError: string | null = null;
  try {
    builders = await listBuilders();
  } catch (error) {
    registryError = error instanceof RegistryCorrupt
      ? error.message
      : String((error as Error)?.message ?? error);
  }

  const counts = new Map<string, number>();
  for (const builder of builders) {
    counts.set(builder.cli, (counts.get(builder.cli) ?? 0) + 1);
  }

  return NextResponse.json({
    status,
    snapshot: snap.data,
    snapshotError: snap.error,
    registryError,
    builders: builders.map((builder) => ({
      id: builder.id,
      cli: builder.cli,
      name: builder.name,
      isDefault: builder.isDefault,
      authKind: builder.auth.kind,
    })),
    clis: allClis().map((cli) => ({
      id: cli.id,
      label: cli.label,
      profileCount: counts.get(cli.id) ?? 0,
    })),
    runtimeProjectionEnabled,
    runtimeAttempts: projected.attempts,
    runtimeProjectionError: projected.error,
    ...snapshotMeta,
    ...summaryMeta,
    ...workerMeta,
  });
}
