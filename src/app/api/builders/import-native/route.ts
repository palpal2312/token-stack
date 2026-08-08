import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { detectNativeProfiles } from "@/lib/builders/nativeProfiles";
import { createNativeImport, publicBuilder, NativeImportExists, RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import one CLI-native profile as a Builder. The {cli, name} pair is looked up
 * in a fresh detection run rather than trusted — a client can only ever import
 * something the CLI really has, with the args the detector computed.
 */
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => null) as { cli?: unknown; name?: unknown } | null;
  const cli = typeof body?.cli === "string" ? body.cli : "";
  const name = typeof body?.name === "string" ? body.name : "";
  if (!cli || !name) return NextResponse.json({ error: "Which CLI profile? Send {cli, name}." }, { status: 400 });

  const found = detectNativeProfiles().find((p) => p.cli === cli && p.name === name);
  if (!found) {
    return NextResponse.json({ error: `${cli} has no native profile named "${name}" (any more?).` }, { status: 404 });
  }

  try {
    const builder = await createNativeImport({
      cli: found.cli, profileName: found.name, args: found.args, source: found.source,
      provider: found.provider,
    });
    return NextResponse.json({ builder: publicBuilder(builder) }, { status: 201 });
  } catch (e) {
    if (e instanceof NativeImportExists) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
