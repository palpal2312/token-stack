import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getProfile, getCurrentRevision } from "@/lib/dify/profile-registry";
import { DIFY_METADATA_RESPONSE_BYTES } from "@/lib/dify/limits";

/**
 * GET /api/integrations/dify/connections/[connectionId]/workflow
 * Fetch sanitized workflow info and parameters from Dify.
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

    const revision = await getCurrentRevision(connectionId);
    if (!revision) {
      return NextResponse.json({ error: "No active revision found" }, { status: 500 });
    }

    if (!revision.validated) {
      return NextResponse.json(
        { error: "Profile not validated. Run health check first." },
        { status: 400 }
      );
    }

    // Fetch /info and /parameters in parallel
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const [infoResponse, parametersResponse] = await Promise.all([
        fetch(`${revision.baseUrl}/info`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${revision.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        }),
        fetch(`${revision.baseUrl}/parameters`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${revision.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        }),
      ]);

      clearTimeout(timeoutId);

      if (!infoResponse.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch workflow info: ${infoResponse.status}`,
            detail: await infoResponse.text().catch(() => "No response body"),
          },
          { status: 502 }
        );
      }

      if (!parametersResponse.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch workflow parameters: ${parametersResponse.status}`,
            detail: await parametersResponse.text().catch(() => "No response body"),
          },
          { status: 502 }
        );
      }

      // Check response size limits
      const infoLength = parseInt(infoResponse.headers.get("content-length") || "0", 10);
      const parametersLength = parseInt(parametersResponse.headers.get("content-length") || "0", 10);

      if (infoLength > DIFY_METADATA_RESPONSE_BYTES) {
        return NextResponse.json(
          { error: `Info response too large: ${infoLength} bytes exceeds ${DIFY_METADATA_RESPONSE_BYTES} limit` },
          { status: 413 }
        );
      }

      if (parametersLength > DIFY_METADATA_RESPONSE_BYTES) {
        return NextResponse.json(
          { error: `Parameters response too large: ${parametersLength} bytes exceeds ${DIFY_METADATA_RESPONSE_BYTES} limit` },
          { status: 413 }
        );
      }

      const info = await infoResponse.json();
      const parameters = await parametersResponse.json();

      // Sanitize and return
      return NextResponse.json({
        info: {
          name: info.name,
          description: info.description,
          tags: info.tags || [],
          mode: info.mode,
        },
        parameters: sanitizeParameters(parameters),
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        return NextResponse.json(
          { error: "Request timeout", detail: "Dify service did not respond within 10 seconds" },
          { status: 504 }
        );
      }

      return NextResponse.json(
        {
          error: "Failed to fetch workflow metadata",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: `Workflow fetch failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * Sanitize Dify parameters for public exposure.
 * Remove any secret-shaped fields and normalize types.
 */
function sanitizeParameters(params: unknown): unknown {
  if (!params || typeof params !== "object") {
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(sanitizeParameters);
  }

  const sanitized: Record<string, unknown> = {};
  const obj = params as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    // Skip secret-shaped keys
    if (/(?:api[-_]?key|authorization|password|secret|token|credential)/i.test(key)) {
      continue;
    }

    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeParameters(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
