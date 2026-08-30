/**
 * Test-fixture switch for the Phase 19a shell diagnostics (Phase 19a U3).
 *
 * The browser spec boots the QA server with `AGENTIC_OS_ALLOW_TEST_FIXTURE=1` to
 * inject a canonical Phase 8b ack fixture. This switch is resolved server-side
 * (a client cannot read env) and threaded down as a prop — the same seam the
 * `desktop_shell_v2` / `sen_surface_coordinator` flags use. OFF by default: the
 * diagnostic sink is never mounted, so production behavior is byte-equivalent.
 *
 * Only the QA test fixture flag may enable it — a query param or view preference
 * must never. It never fakes a canonical ack: the fixture path CALLS the same
 * `seedCommittedAck` the genuine send-turn flow uses, and the cache read stays
 * authoritative.
 */
export function testFixtureEnabled(env = process.env): boolean {
  const v = env.AGENTIC_OS_ALLOW_TEST_FIXTURE;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true";
}