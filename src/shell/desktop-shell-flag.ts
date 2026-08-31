/**
 * Rollout flag surface for the Phase 19a U1 desktop shell (Phase 19a plan,
 * "Rollout": flags `desktop_shell_v2` … with baseline -> shell rollout order).
 *
 * OFF by default and intentionally inert. The root layout reads this flag at
 * request time on the server: when ON it mounts `DesktopShell`; when OFF it
 * keeps the current `Shell` exactly, so the production default is
 * byte-equivalent to today. Only server-side rollout (env `DESKTOP_SHELL_V2`)
 * flips it — a query param or view preference may never.
 */
export const DESKTOP_SHELL_V2 = "desktop_shell_v2" as const;

/** Truthy when the env flag is exactly `1` or `true` (case-insensitive). */
export function desktopShellV2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.DESKTOP_SHELL_V2;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}