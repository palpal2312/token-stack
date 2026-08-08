import { NextResponse } from "next/server";
import { herdrSnapshot, herdrStatus } from "@/lib/herdr";
import { listBuilders, RegistryCorrupt } from "@/lib/builders/registry";
import { allClis } from "@/lib/builders/clis";
import {
  readRuntimeProjection,
  type GoRuntimeAttempt,
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

/**
 * Code Space's combined read: direct Herdr data remains attach/transport state,
 * while canonical Attempt lifecycle comes from the Go runtime projection.
 *
 * Projection is read whenever the daemon is up, regardless of write-authority
 * flag state. This preserves projection visibility during flag-off rollback.
 */
export async function GET() {
  const runtimeProjectionEnabled = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1";

  // Concurrently fetch Herdr snapshot and Go runtime projection.
  // Using herdrSnapshot directly avoids double CLI calls and timeouts when server is offline.
  const [snap, projected] = await Promise.all([
    herdrSnapshot(),
    runtimeProjectionRead(true),
  ]);

  const status = {
    installed: true,
    bin: null,
    version: null,
    running: snap.ok,
    error: snap.ok ? null : (snap.error ?? "Herdr server is not running."),
  };

  if (!snap.ok || !snap.data) {
    return NextResponse.json({
      status,
      snapshot: null,
      builders: [],
      clis: [],
      runtimeProjectionEnabled,
      runtimeAttempts: projected.attempts,
      runtimeProjectionError: projected.error,
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
  });
}
