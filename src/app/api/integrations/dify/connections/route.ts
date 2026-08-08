import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readBoundedJson, validateRequiredString, validateOptionalString, isRecord } from "@/lib/dify/request";
import { validateDifyUrl } from "@/lib/dify/url-policy";
import { sanitizeProfiles, sanitizeProfile } from "@/lib/dify/sanitizer";
import {
  readRegistry,
  generateProfileId,
  generateRevisionId,
  maskApiKey,
  upsertProfile,
} from "@/lib/dify/profile-registry";
import { DIFY_MAX_PROFILES } from "@/lib/dify/limits";
import type { DifyProfile, DifyConnectionRevision } from "@/lib/dify/contracts";

/**
 * GET /api/integrations/dify/connections
 * List all Dify connection profiles (sanitized).
 */
export async function GET(req: Request) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  try {
    const registry = await readRegistry();
    const activeProfiles = registry.profiles.filter((p) => !p.tombstone);
    return NextResponse.json({ profiles: sanitizeProfiles(activeProfiles) });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read profiles: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/dify/connections
 * Create a new Dify connection profile.
 */
export async function POST(req: Request) {
  const guardResult = await checkLocalRequest(req, { requireJson: req.method !== "GET" });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const bodyResult = await readBoundedJson<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.statusCode });
  }

  const body = bodyResult.data;

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  // Validate required fields
  const nameResult = validateRequiredString(body, "name");
  if (!nameResult.ok) {
    return NextResponse.json({ error: nameResult.error }, { status: 400 });
  }

  const baseUrlResult = validateRequiredString(body, "baseUrl");
  if (!baseUrlResult.ok) {
    return NextResponse.json({ error: baseUrlResult.error }, { status: 400 });
  }

  const apiKeyResult = validateRequiredString(body, "apiKey");
  if (!apiKeyResult.ok) {
    return NextResponse.json({ error: apiKeyResult.error }, { status: 400 });
  }

  // Validate optional studioLink
  const studioLinkResult = validateOptionalString(body, "studioLink");
  if (!studioLinkResult.ok) {
    return NextResponse.json({ error: studioLinkResult.error }, { status: 400 });
  }

  // Validate URL
  const urlValidation = validateDifyUrl(baseUrlResult.value);
  if (!urlValidation.ok) {
    return NextResponse.json({ error: urlValidation.error }, { status: 400 });
  }

  // Check profile count limit
  try {
    const registry = await readRegistry();
    const activeProfiles = registry.profiles.filter((p) => !p.tombstone);
    if (activeProfiles.length >= DIFY_MAX_PROFILES) {
      return NextResponse.json(
        { error: `Profile limit reached: ${DIFY_MAX_PROFILES} profiles maximum` },
        { status: 413 }
      );
    }

    // Create new profile
    const now = new Date().toISOString();
    const profileId = generateProfileId();
    const revisionId = generateRevisionId();

    const revision: DifyConnectionRevision = {
      revisionId,
      profileId,
      baseUrl: urlValidation.validated!.serviceApiBase,
      apiKey: apiKeyResult.value,
      keyHint: maskApiKey(apiKeyResult.value),
      validated: undefined,
      createdAt: now,
      referencedBy: [],
      active: false,
    };

    const profile: DifyProfile = {
      id: profileId,
      name: nameResult.value,
      baseUrl: urlValidation.validated!.serviceApiBase,
      apiKey: apiKeyResult.value,
      revisionId,
      revisions: [revision],
      studioLink: studioLinkResult.value,
      createdAt: now,
      updatedAt: now,
    };

    await upsertProfile(profile);

    return NextResponse.json({ profile: sanitizeProfile(profile) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to create profile: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
