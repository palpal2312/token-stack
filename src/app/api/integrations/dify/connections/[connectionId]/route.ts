import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readBoundedJson, validateRequiredString, validateOptionalString, isRecord } from "@/lib/dify/request";
import { validateDifyUrl } from "@/lib/dify/url-policy";
import { sanitizeProfile } from "@/lib/dify/sanitizer";
import {
  getProfile,
  upsertProfile,
  deleteProfile,
  generateRevisionId,
  maskApiKey,
  countRevisions,
  purgeOldestRevision,
} from "@/lib/dify/profile-registry";
import { DIFY_MAX_CONNECTION_REVISIONS } from "@/lib/dify/limits";
import type { DifyConnectionRevision } from "@/lib/dify/contracts";

/**
 * GET /api/integrations/dify/connections/[connectionId]
 * Get a specific connection profile (sanitized).
 */
export async function GET(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { connectionId } = await ctx.params;

  try {
    const profile = await getProfile(connectionId);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (profile.tombstone) {
      return NextResponse.json({ error: "Profile has been deleted" }, { status: 410 });
    }

    return NextResponse.json({ profile: sanitizeProfile(profile) });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to get profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/integrations/dify/connections/[connectionId]
 * Update a connection profile.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { connectionId } = await ctx.params;

  const bodyResult = await readBoundedJson<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.statusCode });
  }

  const body = bodyResult.data;

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  try {
    const profile = await getProfile(connectionId);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (profile.tombstone) {
      return NextResponse.json({ error: "Cannot update deleted profile" }, { status: 410 });
    }

    const now = new Date().toISOString();
    let needsNewRevision = false;
    let newRevision: DifyConnectionRevision | null = null;

    // Update name if provided
    const nameResult = validateOptionalString(body, "name");
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 });
    }
    if (nameResult.value) {
      profile.name = nameResult.value;
    }

    // Update studioLink if provided
    const studioLinkResult = validateOptionalString(body, "studioLink");
    if (!studioLinkResult.ok) {
      return NextResponse.json({ error: studioLinkResult.error }, { status: 400 });
    }
    if (studioLinkResult.value !== undefined) {
      profile.studioLink = studioLinkResult.value;
    }

    // Check if baseUrl or apiKey is being updated (requires new revision)
    const baseUrlResult = validateOptionalString(body, "baseUrl");
    if (!baseUrlResult.ok) {
      return NextResponse.json({ error: baseUrlResult.error }, { status: 400 });
    }

    const apiKeyResult = validateOptionalString(body, "apiKey");
    if (!apiKeyResult.ok) {
      return NextResponse.json({ error: apiKeyResult.error }, { status: 400 });
    }

    if (baseUrlResult.value || apiKeyResult.value) {
      needsNewRevision = true;

      // Get current revision for defaults
      const currentRevision = profile.revisions.find((r) => r.revisionId === profile.revisionId);
      if (!currentRevision) {
        return NextResponse.json({ error: "Current revision not found" }, { status: 500 });
      }

      // Validate new baseUrl if provided
      let validatedBase = currentRevision.baseUrl;
      if (baseUrlResult.value) {
        const urlValidation = validateDifyUrl(baseUrlResult.value);
        if (!urlValidation.ok) {
          return NextResponse.json({ error: urlValidation.error }, { status: 400 });
        }
        validatedBase = urlValidation.validated!.serviceApiBase;
      }

      // Check revision count limit
      const revisionCount = await countRevisions(connectionId);
      if (revisionCount >= DIFY_MAX_CONNECTION_REVISIONS) {
        // Try to purge oldest unreferenced revision
        const purged = await purgeOldestRevision(connectionId, new Set());
        if (!purged) {
          return NextResponse.json(
            { error: `Revision limit reached: ${DIFY_MAX_CONNECTION_REVISIONS} maximum` },
            { status: 409 }
          );
        }
      }

      const revisionId = generateRevisionId();
      newRevision = {
        revisionId,
        profileId: connectionId,
        baseUrl: validatedBase,
        apiKey: apiKeyResult.value || currentRevision.apiKey,
        keyHint: apiKeyResult.value ? maskApiKey(apiKeyResult.value) : currentRevision.keyHint,
        validated: undefined,
        createdAt: now,
        referencedBy: [],
        active: false,
      };

      profile.revisions.push(newRevision);
      profile.revisionId = revisionId;
      profile.baseUrl = validatedBase;
    }

    profile.updatedAt = now;
    await upsertProfile(profile);

    return NextResponse.json({ profile: sanitizeProfile(profile) });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to update profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/dify/connections/[connectionId]
 * Delete a connection profile.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { connectionId } = await ctx.params;

  try {
    const profile = await getProfile(connectionId);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Check if there are running/blocked runs referencing this profile
    // For now, always hard delete (Phase 3 will track references)
    const hasReferences = false;

    await deleteProfile(connectionId, hasReferences);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to delete profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
