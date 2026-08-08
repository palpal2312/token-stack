import type { DifyProfile, DifyPublicProfile, DifyConnectionRevision } from "./contracts";

/**
 * Sanitize a profile for public API responses.
 * Removes all secret material (API keys, authorization headers).
 */
export function sanitizeProfile(profile: DifyProfile): DifyPublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    revisionId: profile.revisionId,
    studioLink: profile.studioLink,
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
    tombstone: profile.tombstone,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/**
 * Sanitize a connection revision for public API responses.
 * Includes masked key hint but never the actual key.
 */
export function sanitizeRevision(revision: DifyConnectionRevision): Omit<DifyConnectionRevision, "apiKey"> {
  return {
    revisionId: revision.revisionId,
    profileId: revision.profileId,
    baseUrl: revision.baseUrl,
    keyHint: revision.keyHint,
    validated: revision.validated ? { ...revision.validated } : undefined,
    createdAt: revision.createdAt,
    lastValidatedAt: revision.lastValidatedAt,
    referencedBy: [...revision.referencedBy],
    active: revision.active,
  };
}

/**
 * Sanitize multiple profiles.
 */
export function sanitizeProfiles(profiles: DifyProfile[]): DifyPublicProfile[] {
  return profiles.map(sanitizeProfile);
}

/**
 * Validate that an object is safe for public exposure.
 * Returns validation errors if any secret-shaped keys are found.
 */
export function validatePublicSafe(obj: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!obj || typeof obj !== "object") {
    return { ok: true, errors };
  }

  const secretPatterns = [
    /api[-_]?key/i,
    /authorization/i,
    /password/i,
    /secret/i,
    /token/i,
    /credential/i,
  ];

  function checkObject(o: unknown, path: string): void {
    if (!o || typeof o !== "object") return;

    if (Array.isArray(o)) {
      o.forEach((item, index) => checkObject(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(o)) {
      const fullPath = path ? `${path}.${key}` : key;

      // Check if key name looks like a secret
      if (secretPatterns.some((pattern) => pattern.test(key))) {
        errors.push(`Found secret-shaped key at ${fullPath}`);
      }

      // Recursively check nested objects
      if (typeof value === "object" && value !== null) {
        checkObject(value, fullPath);
      }
    }
  }

  checkObject(obj, "");
  return { ok: errors.length === 0, errors };
}
