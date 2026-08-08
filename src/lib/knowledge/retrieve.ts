import { LexicalIndex, type IndexDocument } from "./index";

export interface RetrievedContext {
  content: string;
  citations: string[];
  truncated: boolean;
}

export class ContextAssembler {
  constructor(
    private readonly index: LexicalIndex,
    private readonly maxChars: number = 8000
  ) {}

  async retrieve(query: string, limit: number = 5): Promise<RetrievedContext> {
    const docs = await this.index.search(query, limit);
    let content = "";
    const citations: string[] = [];
    let truncated = false;

    for (const doc of docs) {
      citations.push(doc.sourceId);
      const chunk = `\n--- [Citation: ${doc.sourceId}] ---\n${doc.content}\n`;
      if (content.length + chunk.length > this.maxChars) {
        const remaining = this.maxChars - content.length - 15; // 15 for "... [TRUNCATED]"
        if (remaining > 50) {
          content += chunk.substring(0, remaining) + "... [TRUNCATED]";
        }
        truncated = true;
        break;
      }
      content += chunk;
    }

    return {
      content: content.trim(),
      citations,
      truncated
    };
  }
}
