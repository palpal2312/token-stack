import { shadowCompareResponse } from "@/lib/senShadowProxy";
import { GET as firstmateThread } from "../../../firstmate/threads/[id]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alias for the firstmate thread transcript; this route stays the authority
// while the Go read model is shadow-read only. Shadow mode (phase 05): the Go
// control plane's GET /v1/sen/threads/{id} is compared against the same
// payload (per-route field comparison, see SHADOW_ROUTE_COMPARISON) and
// divergences are logged. Non-ok legacy responses (400/404) are skipped by the
// harness — an erroring legacy side has no payload to compare. The observation
// clones the response, so the returned body is byte-identical with shadow on
// or off.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const res = await firstmateThread(req, ctx);
  const { id } = await ctx.params;
  void shadowCompareResponse("sen/threads/{id}", `/v1/sen/threads/${encodeURIComponent(id)}`, res);
  return res;
}
