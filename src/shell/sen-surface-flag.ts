/**
 * Rollout flag surface for the Phase 19a U2 SEN surface coordinator (Phase 19a
 * plan, "Rollout": flags `desktop_shell_v2`, `sen_surface_coordinator` … with
 * baseline -> shell -> panel coordinator rollout order).
 *
 * OFF by default and intentionally inert. The DESKTOP_SHELL_V2 shell stays the
 * byte-equivalent default; even with that shell ON, the surface coordinator only
 * mounts when THIS flag is also ON — otherwise the legacy SenView/composer
 * behavior is preserved exactly. Only server-side rollout (env
 * `SEN_SURFACE_COORDINATOR`) flips it; a query param or view preference may never.
 */
export const SEN_SURFACE_COORDINATOR = "sen_surface_coordinator" as const;

/** Truthy when the env flag is exactly `1` or `true` (case-insensitive). */
export function senSurfaceCoordinatorEnabled(env = process.env): boolean {
  const v = env.SEN_SURFACE_COORDINATOR;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}