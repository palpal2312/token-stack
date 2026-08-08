import { shadowCompareResponse } from "@/lib/senShadowProxy";
import { GET as firstmateOverview } from "../firstmate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alias for the firstmate overview; this route stays the authority while the
// Go projection is shadow-read only. Shadow mode (phase 05): the Go control
// plane's /v1/sen/overview is compared against the same payload (per-route
// field comparison, see SHADOW_ROUTE_COMPARISON) and divergences are logged.
// The observation clones the response, so the returned body is byte-identical
// with shadow on or off.
export async function GET(req: Request) {
  const res = await firstmateOverview(req);
  void shadowCompareResponse("sen", "/v1/sen/overview", res);
  return res;
}
