export interface FeedbackAnnotation {
  id: string;
  runId: string;
  targetId?: string; // e.g. artifactId, stepId
  authorId: string;
  sentiment: "positive" | "negative" | "neutral";
  comment?: string;
  tags?: string[];
  createdAt: string;
}

export class FeedbackRepository {
  private feedback = new Map<string, FeedbackAnnotation>();

  async recordFeedback(annotation: Omit<FeedbackAnnotation, "createdAt" | "id">): Promise<FeedbackAnnotation> {
    const id = `fb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const record: FeedbackAnnotation = {
      ...annotation,
      id,
      createdAt: new Date().toISOString()
    };
    
    this.feedback.set(id, record);
    // TODO: durably persist
    
    return record;
  }

  async getFeedbackForRun(runId: string): Promise<FeedbackAnnotation[]> {
    const results: FeedbackAnnotation[] = [];
    for (const fb of this.feedback.values()) {
      if (fb.runId === runId) {
        results.push(fb);
      }
    }
    return results;
  }
}
