import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getEnablementStatus, createOrVerifyBackup } from "@/lib/dify/enablement";

/**
 * GET /api/integrations/dify/enable
 * Get Dify enablement status.
 */
export async function GET(req: Request) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  try {
    const status = await getEnablementStatus();
    return NextResponse.json({
      enabled: status.enabled,
      backupExists: status.backupExists,
      backupVerified: status.backupVerified,
      createdAt: status.marker?.createdAt,
      verifiedAt: status.marker?.verifiedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to get enablement status: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/dify/enable
 * Create or verify Dify enablement backup.
 */
export async function POST(req: Request) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  try {
    const result = await createOrVerifyBackup();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      enabled: true,
      backupPath: result.backupPath,
      backupHash: result.backupHash,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to enable Dify: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
