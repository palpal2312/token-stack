import { validateRequiredString } from "./request";
import { isRecord, isNonEmptyString } from "./request";
import type { DifyParameterType } from "./contracts";

/**
 * Normalized input type.
 */
export type NormalizedInputType = "text" | "number" | "boolean" | "select" | "file";

/**
 * Normalized input value.
 */
export type NormalizedInputValue = string | number | boolean | DifyUploadDescriptor;

/**
 * Upload descriptor for Dify APIs.
 */
export interface DifyUploadDescriptor {
  transfer_method: "local_file" | "remote_url";
  upload_file_id?: string;
  url?: string;
  type?: string;
}

/**
 * Validate and normalize a workflow input based on its expected type.
 */
export function normalizeInput(
  value: unknown,
  expectedType: DifyParameterType
): { ok: true; value: NormalizedInputValue } | { ok: false; error: string } {
  switch (expectedType) {
    case "text":
    case "paragraph": {
      if (typeof value !== "string") {
        return { ok: false, error: "Expected string value" };
      }
      return { ok: true, value };
    }
    case "number": {
      if (typeof value === "number") {
        return { ok: true, value };
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        if (!isNaN(parsed)) {
          return { ok: true, value: parsed };
        }
      }
      return { ok: false, error: "Expected number value" };
    }
    case "boolean": {
      if (typeof value === "boolean") {
        return { ok: true, value };
      }
      if (value === "true") return { ok: true, value: true };
      if (value === "false") return { ok: true, value: false };
      return { ok: false, error: "Expected boolean value" };
    }
    case "select": {
      if (typeof value !== "string") {
        return { ok: false, error: "Expected string value for select" };
      }
      return { ok: true, value };
    }
    case "file": {
      if (!isRecord(value)) {
        return { ok: false, error: "Expected file upload descriptor" };
      }
      const transfer_method = value["transfer_method"];
      if (transfer_method === "local_file") {
        const upload_file_id = value["upload_file_id"];
        if (typeof upload_file_id !== "string" || !upload_file_id.trim()) {
          return { ok: false, error: "local_file requires upload_file_id" };
        }
        return { ok: true, value: { transfer_method: "local_file", upload_file_id } };
      }
      if (transfer_method === "remote_url") {
        const url = value["url"];
        if (typeof url !== "string" || !url.trim()) {
          return { ok: false, error: "remote_url requires url" };
        }
        return { ok: true, value: { transfer_method: "remote_url", url } };
      }
      return { ok: false, error: "Invalid transfer_method" };
    }
    case "file-list": {
      return { ok: false, error: "file-list is not supported yet" };
    }
    default:
      return { ok: false, error: `Unsupported input type: ${expectedType}` };
  }
}

export function normalizeWorkflowInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'string') {
      normalized[key] = value.trim();
    } else if (value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }

  return normalized;
}

export function generateUserIdentifier(profileId: string): string {
  return `agent-os:${profileId}`;
}

export function getAgentOsUser(profileId: string): string {
  return `agent-os:${profileId}`;
}
