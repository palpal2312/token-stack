import { type Span } from "./tracing";

export interface TraceExporter {
  exportSpans(spans: Span[]): Promise<void>;
  shutdown(): Promise<void>;
}

export class NoopTraceExporter implements TraceExporter {
  async exportSpans(spans: Span[]): Promise<void> {
    // No-op
  }
  
  async shutdown(): Promise<void> {
    // No-op
  }
}

export class OTLPTraceExporter implements TraceExporter {
  private url: string;
  
  constructor(url: string) {
    this.url = url;
  }
  
  async exportSpans(spans: Span[]): Promise<void> {
    if (spans.length === 0) return;
    
    // Fail-open: catch and swallow to prevent failing a coding run
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spans })
      });
    } catch (e) {
      // Intentionally swallowed for fail-open telemetry
      console.warn(`[OTLP Export Failed]: ${String((e as Error)?.message ?? e)}`);
    }
  }

  async shutdown(): Promise<void> {
    // Flush if we were queueing. Currently synchronous fetch.
  }
}

export function getTraceExporter(): TraceExporter {
  const endpoint = process.env.OTLP_TRACE_ENDPOINT;
  return endpoint ? new OTLPTraceExporter(endpoint) : new NoopTraceExporter();
}
