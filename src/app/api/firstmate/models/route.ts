import { NextResponse } from "next/server";
import { getBuilder } from "@/lib/builders/registry";
import { modelsForBuilder } from "@/lib/sen-models";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The models a Builder can actually run, read from the CLI's own config. */
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const url = new URL(req.url);
  const id = url.searchParams.get("builder")?.trim();
  if (!id) return NextResponse.json({ error: "Which builder? (?builder=<id>)" }, { status: 400 });
  const builder = await getBuilder(id);
  if (!builder) return NextResponse.json({ error: `No Builder profile "${id}".` }, { status: 404 });
  try {
    // Default is the config/cache-derived answer; the live CLI probes (codex
    // app-server handshake, agy PTY, /v1/models fetches) are opt-in via
    // ?live=1 — sen-models' own contract calls live "too slow for navigation".
    const live = url.searchParams.get("live") === "1";
    const { models, cliDefault, source } = await modelsForBuilder(builder, { live, signal: req.signal });
    return NextResponse.json({
      models, cliDefault, source,
      builderModel: builder.model,
      effort: builder.effort ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
