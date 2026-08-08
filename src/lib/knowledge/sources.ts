export interface KnowledgeSource {
  id: string;
  type: "workspace" | "docs" | "artifact" | "run" | "note";
  uri: string;
  revision?: string;
  metadata?: Record<string, unknown>;
}

export interface SourcePolicy {
  excludePaths: string[];
  maxSizeBytes: number;
  allowBinaries: boolean;
}

export const DEFAULT_SOURCE_POLICY: SourcePolicy = {
  excludePaths: [".git", "node_modules", ".next", "dist", "build", "coverage", ".env"],
  maxSizeBytes: 1024 * 1024, // 1MB
  allowBinaries: false,
};

export function isAllowedByPolicy(path: string, size: number, policy: SourcePolicy = DEFAULT_SOURCE_POLICY): boolean {
  if (size > policy.maxSizeBytes) return false;
  if (policy.excludePaths.some(p => path.includes(p))) return false;
  // Naive binary check via extension for now
  if (!policy.allowBinaries && path.match(/\.(exe|dll|so|dylib|bin|png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|bz2)$/i)) {
    return false;
  }
  return true;
}
