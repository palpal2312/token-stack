/** Canonical localhost port for the Agent OS dashboard (Mission Control). */
export const DASHBOARD_PORT = 3737;

export const DASHBOARD_HOST = "127.0.0.1";

/** Loopback origin for the dashboard, e.g. http://127.0.0.1:3737 */
export function dashboardOrigin(port = DASHBOARD_PORT): string {
  return `http://${DASHBOARD_HOST}:${port}`;
}
