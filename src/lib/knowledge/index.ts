import { type KnowledgeSource } from "./sources";

export interface IndexDocument {
  id: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  hash: string;
  isTombstone?: boolean;
}

export class LexicalIndex {
  private documents: Map<string, IndexDocument> = new Map();

  async add(doc: IndexDocument): Promise<void> {
    if (doc.isTombstone) {
      this.documents.delete(doc.id);
    } else {
      this.documents.set(doc.id, doc);
    }
  }

  async remove(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async search(query: string, limit: number = 10): Promise<IndexDocument[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored = Array.from(this.documents.values()).map(doc => {
      const text = doc.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }
      return { doc, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.doc);
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}
