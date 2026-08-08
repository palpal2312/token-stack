import type { KanbanEvent } from "./types";

type Subscriber = (event: KanbanEvent) => void;

const subscribers = new Set<Subscriber>();

export function publishKanbanEvent(event: KanbanEvent): void {
  for (const subscriber of subscribers) {
    try { subscriber(event); } catch { /* one broken client cannot break writers */ }
  }
}

export function subscribeKanbanEvents(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}

export function kanbanSubscriberCount(): number {
  return subscribers.size;
}

