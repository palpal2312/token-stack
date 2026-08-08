export type SandboxTier = "read-only" | "workspace-write" | "external";

export interface SandboxProfile {
  tier: SandboxTier;
  allowEgress: boolean;
  allowedOrigins?: string[];
}

export function validateEgress(profile: SandboxProfile, url: string): boolean {
  if (!profile.allowEgress) return false;
  if (!profile.allowedOrigins || profile.allowedOrigins.length === 0) return true;
  
  try {
    const target = new URL(url);
    return profile.allowedOrigins.some(origin => {
      const allowed = new URL(origin);
      return target.protocol === allowed.protocol && target.host === allowed.host;
    });
  } catch {
    return false;
  }
}

export function enforcePath(profile: SandboxProfile, requestedPath: string, workspaceRoot: string): boolean {
  if (profile.tier === "external") return true;
  if (profile.tier === "read-only") return false; // Not allowing writes in read-only
  
  // Basic path jail check
  // In a real implementation this would check realpath to avoid symlink escapes
  return requestedPath.startsWith(workspaceRoot);
}
