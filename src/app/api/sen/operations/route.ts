import { NextResponse } from "next/server";
import { RunLedger } from "@/lib/llmops/ledger";
import { OperationsManager } from "@/lib/llmops/operations";
import { HealthReporter } from "@/lib/llmops/health";
import { MigrationManager } from "@/lib/llmops/migrations";
import { checkLocalRequest } from "@/lib/localOnly";
import os from "node:os";
import path from "node:path";

const ledger = new RunLedger();
const migrationManager = new MigrationManager();
const opsManager = new OperationsManager(ledger);
const healthReporter = new HealthReporter(ledger, migrationManager);

export async function GET(request: Request) {
  const guard = checkLocalRequest(request, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "health") {
    const health = await healthReporter.check();
    return NextResponse.json(health);
  }

  if (action === "release-gate") {
    const report = await opsManager.releaseGateReport();
    return NextResponse.json(report);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function POST(request: Request) {
  const guard = checkLocalRequest(request);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await request.json();
    const action = body.action;

    if (action === "backup") {
      const destination = body.destination ?? path.join(os.tmpdir(), `sen-backup-${Date.now()}`);
      await opsManager.backup(destination);
      return NextResponse.json({ ok: true, destination });
    }

    if (action === "verify") {
      const result = await opsManager.verify();
      return NextResponse.json(result);
    }

    if (action === "release-check") {
      const report = await opsManager.releaseGateReport();
      return NextResponse.json(report, { status: report.canCutover ? 200 : 409 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 }
    );
  }
}
