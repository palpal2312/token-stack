import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getProfile } from "@/lib/dify/profile-registry";
import { globalCapacity, getStagingExpiration } from "@/lib/dify/capacity";
import { 
  DIFY_MAX_STAGED_FILES, 
  DIFY_MAX_STAGED_FILE_BYTES, 
  DIFY_MAX_STAGED_AGGREGATE_BYTES 
} from "@/lib/dify/limits";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { addStagedFile } from "@/lib/dify/staged-files/store";

// Store simple counters per submission ID to track aggregate limits
const submissionAggregates = new Map<string, { count: number, bytes: number }>();

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const guardResult = await checkLocalRequest(req, { requireJson: false });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { connectionId } = await ctx.params;
  const submissionId = req.headers.get("x-agent-os-submission-id");
  const filename = req.headers.get("x-agent-os-filename") || "unnamed";
  const mimeType = req.headers.get("content-type") || "application/octet-stream";
  
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

  if (!submissionId) {
    return NextResponse.json({ error: "Missing x-agent-os-submission-id header" }, { status: 400 });
  }

  if (contentLength > DIFY_MAX_STAGED_FILE_BYTES) {
    return NextResponse.json({ error: `File too large: exceeds ${DIFY_MAX_STAGED_FILE_BYTES} bytes` }, { status: 413 });
  }

  try {
    const profile = await getProfile(connectionId);
    if (!profile || profile.tombstone) {
      return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });
    }

    // Check aggregate limits
    const agg = submissionAggregates.get(submissionId) || { count: 0, bytes: 0 };
    
    if (agg.count >= DIFY_MAX_STAGED_FILES) {
      return NextResponse.json({ error: `Too many files: exceeds ${DIFY_MAX_STAGED_FILES} files per submission` }, { status: 413 });
    }
    
    if (agg.bytes + contentLength > DIFY_MAX_STAGED_AGGREGATE_BYTES) {
      return NextResponse.json({ error: `Aggregate size too large: exceeds ${DIFY_MAX_STAGED_AGGREGATE_BYTES} bytes` }, { status: 413 });
    }

    // Ensure staging dir exists
    const home = process.env.AGENTIC_OS_HOME || path.join(os.homedir(), ".agentic-os");
    const stagingDir = path.join(home, "dify-staging");
    await fs.mkdir(stagingDir, { recursive: true });

    const fileId = crypto.randomBytes(16).toString("hex");
    const filePath = path.join(stagingDir, fileId);

    // Stream the body
    const reader = req.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    let bytesRead = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      bytesRead += value.byteLength;
      
      if (bytesRead > DIFY_MAX_STAGED_FILE_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "File exceeded limits during upload" }, { status: 413 });
      }
      
      chunks.push(value);
    }

    // Reserve global capacity
    try {
      globalCapacity.reserve({
        id: `staged-${fileId}`,
        type: "staging",
        bytes: bytesRead,
        createdAt: new Date().toISOString(),
        expiresAt: getStagingExpiration(),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: e.code || 500 });
    }

    // Write file
    await fs.writeFile(filePath, Buffer.concat(chunks), { mode: 0o600 });

    // Store in our in-memory file tracker (for MVP limits tracking across runs)
    const stagedRefId = await addStagedFile(
      connectionId,
      filename,
      mimeType,
      bytesRead,
      filePath,
      30 * 60 * 1000 // 30 minutes
    );

    // Update aggregate
    submissionAggregates.set(submissionId, {
      count: agg.count + 1,
      bytes: agg.bytes + bytesRead
    });

    return NextResponse.json({
      ok: true,
      ref: {
        id: stagedRefId, // Return the reference ID to the client
        submissionId,
        filename,
        mimeType,
        sizeBytes: bytesRead
      }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
