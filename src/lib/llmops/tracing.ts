import { randomUUID } from "node:crypto";

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface Span {
  context: SpanContext;
  name: string;
  attributes: Record<string, unknown>;
  startTime: string;
  endTime?: string;
  status: "ok" | "error";
  events: Array<{ name: string; at: string; attributes?: Record<string, unknown> }>;
}

/**
 * Creates a new trace context. If a parent is provided, inherits the traceId
 * and sets the parentSpanId to the parent's spanId.
 */
export function createSpanContext(parent?: SpanContext): SpanContext {
  return {
    traceId: parent?.traceId ?? randomUUID(),
    spanId: randomUUID(),
    parentSpanId: parent?.spanId,
  };
}

/**
 * Creates a new span with the given name and optional parent context.
 */
export function startSpan(name: string, parent?: SpanContext, attributes: Record<string, unknown> = {}): Span {
  return {
    context: createSpanContext(parent),
    name,
    attributes,
    startTime: new Date().toISOString(),
    status: "ok",
    events: [],
  };
}

/**
 * Ends a span by setting its endTime.
 */
export function endSpan(span: Span, status: "ok" | "error" = "ok"): Span {
  return {
    ...span,
    endTime: new Date().toISOString(),
    status,
  };
}

/**
 * Adds an event to an active span.
 */
export function addSpanEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
  span.events.push({
    name,
    at: new Date().toISOString(),
    attributes,
  });
}
