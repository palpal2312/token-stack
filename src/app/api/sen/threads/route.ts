import { shadowCompareResponse } from "@/lib/senShadowProxy";
import { GET as firstmateThreads } from "../../firstmate/threads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alias for the firstmate thread list; this route stays the authority while
// the Go read model is shadow-read only. Shadow mode (phase 05): the Go
// control plane's GET /v1/sen/sessions is compared against the same payload
// (per-route field comparison, see SHADOW_ROUTE_COMPARISON) and divergences
// are logged. The observation clones the response, so the returned body is
// byte-identical with shadow on or off.
export async function GET(req: Request) {
  const res = await firstmateThreads(req);
  void shadowCompareResponse("sen/threads", "/v1/sen/sessions", res);
  return res;
}
