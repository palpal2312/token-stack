import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getProfile, getCurrentRevision, upsertProfile } from "@/lib/dify/profile-registry";
import { verifyLoopbackResolution } from "@/lib/dify/url-policy";

/**
 * POST /api/integrations/dify/connections/[connectionId]/health
 * Test connection health and validate Dify Service API accessibility.
 */
export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
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

    const revision = await getCurrentRevision(connectionId);
    if (!revision) {
      return NextResponse.json({ error: "No active revision found" }, { status: 500 });
    }

    // Extract hostname from baseUrl for loopback verification
    const url = new URL(revision.baseUrl);
    const hostname = url.hostname;

    // Verify loopback resolution
    const loopbackCheck = await verifyLoopbackResolution(hostname);
    if (!loopbackCheck.ok) {
      return NextResponse.json(
        {
          error: "Connection failed loopback verification",
          detail: loopbackCheck.error,
          reachable: false,
        },
        { status: 400 }
      );
    }

    // Try to reach /info endpoint
    const infoUrl = `${revision.baseUrl}/info`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(infoUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${revision.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return NextResponse.json(
            {
              error: "Authentication failed",
              detail: "API key may be invalid or expired",
              reachable: true,
              authenticated: false,
            },
            { status: 401 }
          );
        }

        return NextResponse.json(
          {
            error: `Dify API returned ${response.status}`,
            detail: await response.text().catch(() => "No response body"),
            reachable: true,
            authenticated: false,
          },
          { status: 502 }
        );
      }

      // Parse info response
      const info = await response.json();

      // Update profile metadata and mark revision as validated
      const now = new Date().toISOString();
      const revisionIndex = profile.revisions.findIndex((r) => r.revisionId === revision.revisionId);
      if (revisionIndex >= 0) {
        profile.revisions[revisionIndex].validated = {
          serviceApiBase: revision.baseUrl,
          protocolVersion: "v1"
        };
        profile.revisions[revisionIndex].lastValidatedAt = now;
      }

      profile.metadata = {
        name: info.name || profile.name,
        description: info.description,
        tags: info.tags || [],
        lastHealthCheck: now,
        stale: false,
      };
      profile.updatedAt = now;

      await upsertProfile(profile);

      return NextResponse.json({
        reachable: true,
        authenticated: true,
        validated: true,
        info: {
          name: info.name,
          description: info.description,
          tags: info.tags,
        },
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        return NextResponse.json(
          {
            error: "Connection timeout",
            detail: "Dify service did not respond within 10 seconds",
            reachable: false,
          },
          { status: 504 }
        );
      }

      return NextResponse.json(
        {
          error: "Connection failed",
          detail: error instanceof Error ? error.message : String(error),
          reachable: false,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: `Health check failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
