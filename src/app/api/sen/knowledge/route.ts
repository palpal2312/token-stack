import { NextResponse } from "next/server";
import { LexicalIndex } from "@/lib/knowledge/index";
import { ContextAssembler } from "@/lib/knowledge/retrieve";
import { checkLocalRequest } from "@/lib/localOnly";

// Note: In a real app this index would be a durable SQLite database
const globalIndex = new LexicalIndex();
const assembler = new ContextAssembler(globalIndex);

export async function POST(request: Request) {
  const guard = checkLocalRequest(request);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await request.json();
    
    if (body.action === "add") {
      await globalIndex.add({
        id: body.id,
        sourceId: body.sourceId,
        content: body.content,
        metadata: body.metadata ?? {},
        hash: body.hash ?? "none"
      });
      return NextResponse.json({ ok: true });
    }
    
    if (body.action === "search") {
      const result = await assembler.retrieve(body.query, body.limit);
      return NextResponse.json(result);
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 }
    );
  }
}
