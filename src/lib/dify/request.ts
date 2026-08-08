import { DIFY_MAX_PROFILE_BODY_BYTES } from "./limits";

/**
 * Read and parse bounded JSON from a request.
 * Rejects oversized payloads before buffering.
 */
export async function readBoundedJson<T = unknown>(
  req: Request,
  maxBytes: number = DIFY_MAX_PROFILE_BODY_BYTES
): Promise<{ ok: true; data: T } | { ok: false; error: string; statusCode: number }> {
  // Check Content-Length header
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxBytes) {
      return {
        ok: false,
        error: `Request body too large: ${length} bytes exceeds limit of ${maxBytes} bytes`,
        statusCode: 413,
      };
    }
  }

  // Stream and count bytes
  const reader = req.body?.getReader();
  if (!reader) {
    return { ok: false, error: "Request body is required", statusCode: 400 };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          error: `Request body exceeded limit of ${maxBytes} bytes`,
          statusCode: 413,
        };
      }

      chunks.push(value);
    }

    // Decode UTF-8
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(Buffer.concat(chunks));

    // Parse JSON
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 400,
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read request body: ${error instanceof Error ? error.message : String(error)}`,
      statusCode: 500,
    };
  }
}

/**
 * Type guard for record objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard for non-empty strings.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate required string field.
 */
export function validateRequiredString(
  obj: Record<string, unknown>,
  field: string
): { ok: true; value: string } | { ok: false; error: string } {
  const value = obj[field];
  if (!isNonEmptyString(value)) {
    return { ok: false, error: `${field} is required and must be a non-empty string` };
  }
  return { ok: true, value };
}

/**
 * Validate optional string field.
 */
export function validateOptionalString(
  obj: Record<string, unknown>,
  field: string
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const value = obj[field];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isNonEmptyString(value)) {
    return { ok: false, error: `${field} must be a non-empty string when present` };
  }
  return { ok: true, value };
}
