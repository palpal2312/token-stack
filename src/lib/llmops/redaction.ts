import type { RedactionClass } from "./contracts";

// Re-export for callers that only want to name the classification type.
export type { RedactionClass } from "./contracts";

export const REDACTED_SECRET = "[REDACTED]";
export const REDACTED_LOCAL_VALUE = "[LOCAL-SENSITIVE]";
export const TRUNCATED_VALUE = "[TRUNCATED]";

const SECRET_KEY = /(?:^|[_-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const LOCAL_SENSITIVE_KEY = /(?:^|[_-])(prompt|transcript|tool[_-]?(?:input|args)|source(?:code|blob)?|cwd|path|content)(?:$|[_-])/i;
const SECRET_VALUE = /(?:\bbearer\s+[a-z0-9._~+/-]{8,}=*|\bsk-[a-z0-9_-]{8,}\b|\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|-----begin [^-]*private key-----)/i;

export interface RedactionOptions {
  maxDepth?: number;
  /** Maximum entries retained from any single object or array. */
  maxEntries?: number;
  /** Maximum entries retained across the complete payload tree. */
  maxTotalEntries?: number;
  maxStringLength?: number;
}

export interface RedactionResult {
  payload: Record<string, unknown>;
  redactionClass: RedactionClass;
  redactedPaths: string[];
  truncated: boolean;
}

export function classifyPayloadKey(key: string): RedactionClass {
  if (SECRET_KEY.test(normalizeKey(key))) return "secret";
  if (LOCAL_SENSITIVE_KEY.test(normalizeKey(key))) return "local-sensitive";
  return "public";
}

export function redactEventPayload(
  payload: Record<string, unknown>,
  options: RedactionOptions = {},
): RedactionResult {
  const limits = {
    maxDepth: positiveInteger(options.maxDepth, 6),
    maxEntries: positiveInteger(options.maxEntries, 64),
    maxTotalEntries: positiveInteger(options.maxTotalEntries, 256),
    maxStringLength: positiveInteger(options.maxStringLength, 4_096),
  };
  const redactedPaths: string[] = [];
  let redactionClass: RedactionClass = "public";
  let truncated = false;
  let remainingEntries = limits.maxTotalEntries;

  const visit = (value: unknown, path: string, depth: number): unknown => {
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) {
        redactedPaths.push(path || "<root>");
        redactionClass = "secret";
        return REDACTED_SECRET;
      }
      if (value.length > limits.maxStringLength) {
        truncated = true;
        return `${value.slice(0, limits.maxStringLength)}${TRUNCATED_VALUE}`;
      }
      return value;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (value === undefined) return undefined;
    if (depth > limits.maxDepth) {
      truncated = true;
      return TRUNCATED_VALUE;
    }
    if (Array.isArray(value)) {
      const take = Math.min(value.length, limits.maxEntries, remainingEntries);
      if (take < value.length) truncated = true;
      remainingEntries -= take;
      return value.slice(0, take).map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    }
    if (typeof value !== "object") return String(value);

    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    const take = Math.min(entries.length, limits.maxEntries, remainingEntries);
    if (take < entries.length) truncated = true;
    remainingEntries -= take;
    for (const [key, item] of entries.slice(0, take)) {
      const itemPath = path ? `${path}.${key}` : key;
      // Top-level event summaries are derived from local run/tool context and can
      // leak prompts or tool args. Nested schema summaries (for example
      // `projection.quota.summary`) keep their field-specific validation.
      const classification = itemPath === "summary" ? "local-sensitive" : classifyPayloadKey(key);
      if (classification === "secret") {
        output[key] = item === REDACTED_SECRET ? item : REDACTED_SECRET;
        if (item !== REDACTED_SECRET) redactedPaths.push(itemPath);
        redactionClass = "secret";
      } else if (classification === "local-sensitive") {
        output[key] = item === REDACTED_LOCAL_VALUE ? item : REDACTED_LOCAL_VALUE;
        if (item !== REDACTED_LOCAL_VALUE) redactedPaths.push(itemPath);
        if (redactionClass === "public") redactionClass = "local-sensitive";
      } else {
        output[key] = visit(item, itemPath, depth + 1);
      }
    }
    return output;
  };

  return {
    payload: visit(payload, "", 0) as Record<string, unknown>,
    redactionClass,
    redactedPaths,
    truncated,
  };
}

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
