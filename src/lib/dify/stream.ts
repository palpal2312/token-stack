import {
  DIFY_MAX_SSE_FRAME_BYTES,
  DIFY_MAX_STREAM_EVENTS,
  DIFY_STREAM_IDLE_TIMEOUT_MS,
  DIFY_STREAM_WALL_TIME_MS,
} from "./limits";
import type { DifyLifecycleEvent } from "./contracts";

export class DifyStreamError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "DifyStreamError";
  }
}

export type DifyStreamEvent =
  | { type: "lifecycle"; event: DifyLifecycleEvent }
  | { type: "node_started"; data: any }
  | { type: "node_finished"; data: any }
  | { type: "text_chunk"; data: any }
  | { type: "text_replace"; data: any }
  | { type: "ping" }
  | { type: "error"; error: any };

export class DifyStreamParser {
  private buffer = "";
  private eventCount = 0;
  private startTime: number;
  private lastActivityTime: number;

  constructor() {
    this.startTime = Date.now();
    this.lastActivityTime = this.startTime;
  }

  public parseChunk(chunk: Buffer | Uint8Array): DifyStreamEvent[] {
    this.checkLimits(chunk.length);
    this.lastActivityTime = Date.now();

    const decoder = new TextDecoder("utf-8");
    this.buffer += decoder.decode(chunk, { stream: true });

    const events: DifyStreamEvent[] = [];

    while (true) {
      // Look for a blank line \n\n or \r\n\r\n separating SSE frames
      let frameEndIndex = this.buffer.indexOf("\n\n");
      let newlineLen = 2;

      if (frameEndIndex === -1) {
        frameEndIndex = this.buffer.indexOf("\r\n\r\n");
        if (frameEndIndex !== -1) {
          newlineLen = 4;
        }
      }

      // Also support single newline separated frames if ping
      let nextSingleNewlineIndex = this.buffer.indexOf("\n");
      if (frameEndIndex === -1 && nextSingleNewlineIndex !== -1) {
          const line = this.buffer.slice(0, nextSingleNewlineIndex);
          if (line.trim() === "ping") {
             events.push({ type: "ping" });
             this.buffer = this.buffer.slice(nextSingleNewlineIndex + 1);
             continue;
          }
      }

      if (frameEndIndex === -1) {
        break; // Wait for more data
      }

      const frame = this.buffer.slice(0, frameEndIndex);
      this.buffer = this.buffer.slice(frameEndIndex + newlineLen);

      const lines = frame.split(/\r?\n/);
      let eventType = "";
      let dataStr = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("event:")) {
          eventType = line.slice(6);
        } else if (line.startsWith("data: ")) {
          dataStr += dataStr ? "\n" + line.slice(6) : line.slice(6);
        } else if (line.startsWith("data:")) {
          dataStr += dataStr ? "\n" + line.slice(5) : line.slice(5);
        } else if (line === "ping" || line === ": ping" || line === ":") {
          eventType = "ping";
        }
      }

      if (!dataStr && eventType !== "ping") {
          continue; // empty frame
      }

      if (eventType === "ping") {
          events.push({ type: "ping" });
          continue;
      }

      const parsedEvent = this.parseEventData(dataStr, eventType);
      if (parsedEvent) {
          this.eventCount++;
          events.push(parsedEvent);
      }
    }

    return events;
  }

  public finish(): DifyStreamEvent[] {
    this.checkLimits(0);
    if (this.buffer.length > 0) {
      // Decode any remaining bytes
      const decoder = new TextDecoder("utf-8");
      this.buffer += decoder.decode(new Uint8Array(0));

      const lines = this.buffer.split(/\r?\n/);
      let eventType = "";
      let dataStr = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("event:")) {
          eventType = line.slice(6);
        } else if (line.startsWith("data: ")) {
          dataStr += dataStr ? "\n" + line.slice(6) : line.slice(6);
        } else if (line.startsWith("data:")) {
          dataStr += dataStr ? "\n" + line.slice(5) : line.slice(5);
        } else if (line === "ping" || line === ": ping" || line === ":") {
          eventType = "ping";
        }
      }

      this.buffer = "";

      if (eventType === "ping") {
          return [{ type: "ping" }];
      }

      if (dataStr) {
          const parsedEvent = this.parseEventData(dataStr, eventType);
          if (parsedEvent) {
            this.eventCount++;
            return [parsedEvent];
          }
      }
    }
    return [];
  }

  private checkLimits(chunkSize: number) {
    const now = Date.now();
    if (now - this.startTime > DIFY_STREAM_WALL_TIME_MS) {
      throw new DifyStreamError("Stream wall time limit exceeded", "STREAM_TIMEOUT");
    }
    if (now - this.lastActivityTime > DIFY_STREAM_IDLE_TIMEOUT_MS) {
      throw new DifyStreamError("Stream idle timeout exceeded", "STREAM_IDLE");
    }
    if (this.eventCount >= DIFY_MAX_STREAM_EVENTS) {
      throw new DifyStreamError("Maximum stream events exceeded", "MAX_EVENTS");
    }
    if (this.buffer.length + chunkSize > DIFY_MAX_SSE_FRAME_BYTES) {
        throw new DifyStreamError("Maximum SSE frame size exceeded", "MAX_FRAME_SIZE");
    }
  }

  private parseEventData(dataStr: string, overrideEventType?: string): DifyStreamEvent | null {
    try {
      const data = JSON.parse(dataStr);
      const ev = data.event || overrideEventType;
      switch (ev) {
        case "workflow_started":
        case "workflow_paused":
        case "workflow_resumed":
        case "workflow_succeeded":
        case "workflow_failed":
        case "workflow_stopped":
          return {
            type: "lifecycle",
            event: {
              kind: ev,
              workflowRunId: data.workflow_run_id,
              taskId: data.task_id,
              at: data.created_at ? new Date(data.created_at * 1000).toISOString() : new Date().toISOString(),
              metadata: data.data,
            },
          };
        case "node_started":
          return { type: "node_started", data };
        case "node_finished":
          return { type: "node_finished", data };
        case "text_chunk":
          return { type: "text_chunk", data };
        case "text_replace":
          return { type: "text_replace", data };
        case "error":
          return { type: "error", error: data };
        case "ping":
          return { type: "ping" };
        default:
          return null;
      }
    } catch (e) {
      return null;
    }
  }
}

// Add async iterable parser function
export async function* parseDifyStream(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>
): AsyncGenerator<DifyStreamEvent, void, unknown> {
  const parser = new DifyStreamParser();
  const iterator = (
    Symbol.asyncIterator in stream
      ? (stream as AsyncIterable<Uint8Array>)
      : (async function* () {
          const reader = (stream as ReadableStream<Uint8Array>).getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) return;
              if (value) yield value;
            }
          } finally {
            reader.releaseLock();
          }
        })()
  )[Symbol.asyncIterator]();

  try {
    while (true) {
      const nextPromise = iterator.next();

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new DifyStreamError("Stream idle timeout exceeded", "STREAM_IDLE"));
        }, DIFY_STREAM_IDLE_TIMEOUT_MS);
      });

      let result;
      try {
        result = await Promise.race([nextPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (result.done) break;

      const events = parser.parseChunk(result.value);
      for (const event of events) {
        yield event;
      }
    }

    const finalEvents = parser.finish();
    for (const event of finalEvents) {
      yield event;
    }
  } catch (err) {
    if (err instanceof DifyStreamError) {
      yield { type: "error", error: err.message };
      return;
    }
    throw err;
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return();
    }
  }
}
