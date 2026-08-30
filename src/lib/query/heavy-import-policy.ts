/**
 * Phase 19a U4 heavy-import policy (bundle contract: lazy heavy modules).
 *
 * Pure mapping from a route to the heavy lazy modules its OWNING view
 * dynamic-imports, plus the preload decision. It lets an intent prefetch warm
 * exactly the touched route's heavy chunks on hover/focus/high-confidence next
 * action — never every module. Pure: no DOM, no Next imports, no fetch.
 *
 * Heavy chunk specifiers here must match how the owning view actually loads the
 * chunk (a `dynamic(() => import(...))` wrapper or an in-effect `await import(...)`
 * inside the owning component). `three` and `rehype-highlight` are the heavy
 * libraries converted to independent dynamic chunks by this block.
 */

export type HeavyChunkKind =
  | "three"
  | "highlight"
  | "charts"
  | "force-graph"
  | "terminal"
  | "graph";

/** Known heavy chunk kinds; a specifier must map to exactly one. */
export const HEAVY_CHUNK_KINDS: ReadonlySet<HeavyChunkKind> = new Set([
  "three",
  "highlight",
  "charts",
  "force-graph",
  "terminal",
  "graph",
]);

/** Heavy chunk spec that a route's owning view dynamic-imports. */
export interface HeavyChunkSpec {
  /** Module specifier fed to `import(specifier)` — the lazy chunk identity. */
  readonly specifier: string;
  readonly kind: HeavyChunkKind;
}

/**
 * The heavy chunks each route's owning view lazy-loads. This is the import
 * POLICY: `three` lives behind the astros/radar skies, `rehype-highlight`
 * (highlight.js) behind the seo guides. A route not listed owns no eager heavy
 * lazy chunk.
 */
export const ROUTE_HEAVY_CHUNKS: Readonly<Record<string, readonly HeavyChunkSpec[]>> = {
  "/astros": [{ specifier: "three", kind: "three" }],
  "/radar": [{ specifier: "three", kind: "three" }],
  // The /hermes page's astros + radar tabs both render a three.js sky.
  "/hermes": [{ specifier: "three", kind: "three" }],
  "/seo": [{ specifier: "rehype-highlight", kind: "highlight" }],
  "/seo-guide": [{ specifier: "rehype-highlight", kind: "highlight" }],
  // Terminal is already lazy inside HerdrTerminal (xterm/ghostty `import()`).
  "/code-space": [],
};

/** Whether a route's owning view lazy-loads at least one heavy chunk. */
export function routeOwnsLazyHeavy(route: string): boolean {
  const chunks = ROUTE_HEAVY_CHUNKS[route];
  return chunks !== undefined && chunks.length > 0;
}

/** Heavy chunks a route's owning view dynamically imports (empty if unknown). */
export function heavyChunksForRoute(route: string): readonly HeavyChunkSpec[] {
  return ROUTE_HEAVY_CHUNKS[route] ?? [];
}

/**
 * Every distinct heavy chunk specifier the policy can preload. A preload target
 * MUST come from this allowlist — an unknown specifier is a policy bug, not a
 * preload target.
 */
export function allHeavyChunkSpecifiers(): readonly string[] {
  const seen = new Map<string, HeavyChunkKind>();
  for (const chunks of Object.values(ROUTE_HEAVY_CHUNKS)) {
    for (const c of chunks) seen.set(c.specifier, c.kind);
  }
  return [...seen.keys()];
}

export type PreloadDecision =
  | { eager: true; targets: readonly HeavyChunkSpec[] }
  | { eager: false; targets: readonly HeavyChunkSpec[] };

/**
 * Decide the eager heavy preload for ONE route's intent. Always single-route:
 * the returned targets are exactly the touched route's heavy chunks, never the
 * union of every module. Under reduced-motion no eager heavy visual chunk is
 * pre-loaded (the rendering would be motion-less anyway).
 */
export function decideHeavyPreload(
  route: string,
  opts: { reducedMotion?: boolean } = {},
): PreloadDecision {
  const targets = heavyChunksForRoute(route);
  if (targets.length === 0) return { eager: false, targets: [] };
  if (opts.reducedMotion === true) return { eager: false, targets: [] };
  return { eager: true, targets };
}

/**
 * Literal dynamic loaders for each heavy chunk specifier. Bundlers (Turbopack/webpack)
 * must see a LITERAL `import("...")` string to emit a separate lazy chunk — a runtime
 * `import(variable)` is unresolvable. The policy resolves which specifier to load; this
 * table owns the only literal references, so the heavy libs stay out of every static chunk.
 */
const HEAVY_CHUNK_LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  three: () => import("three"),
  "rehype-highlight": () => import("rehype-highlight"),
};

/** Load a declared heavy chunk by specifier. Unknown specifiers are a policy bug → no-op. */
export function loadHeavyChunk(specifier: string): Promise<unknown> {
  const load = HEAVY_CHUNK_LOADERS[specifier];
  return load ? load() : Promise.resolve(null);
}