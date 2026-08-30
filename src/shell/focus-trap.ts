/**
 * Focus-trap decision policy (Phase 19a U6 a11y).
 *
 * Pure decision logic for a modal focus trap: given the number of tab-focusable
 * elements in a trapped region and where the active element sits, decide whether
 * Tab should wrap to the first/last edge. No DOM, no React — unit-testable under
 * node:test. The DOM wiring lives in the component (CommandPalette) and calls
 * `stepFocusTrap` per keydown.
 *
 * Escape-to-close and return-focus are modal-lifetime concerns the host owns;
 * this module only exports the stable pieces a host needs (`ESCAPE_KEY` and the
 * tabstep policy) so the contract stays in ONE place.
 */

/** The key that closes a modal focus trap and returns focus to its invoker. */
export const ESCAPE_KEY = "Escape";

/** CSS selector for the elements a trap wraps focus between. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/** Where a trapped Tab should move, given the active focus position. */
export type TrapStep = { kind: "stay" } | { kind: "wrap-first" } | { kind: "wrap-last" };

/**
 * Decide the TrapStep for a Tab / Shift+Tab press inside a focus trap.
 *
 * - `focusableCount === 0` → stay (nothing to move to).
 * - `focusableCount === 1` → stay (already the only focusable; native movement
 *   would otherwise bounce harmlessly, so we keep the DOM untouched).
 * - Last element, no shift → wrap to first.
 * - First element, shift → wrap to last.
 * - Otherwise → stay (native sequential tabbing handles the middle).
 *
 * `activeIndex` is the 0-based index of `document.activeElement` in the trap's
 * focusable list, or 0 when nothing inside is focused (moving into the trap).
 */
export function stepFocusTrap(
  focusableCount: number,
  activeIndex: number,
  shiftKey: boolean,
): TrapStep {
  if (focusableCount <= 1) return { kind: "stay" };
  if (shiftKey) return activeIndex <= 0 ? { kind: "wrap-last" } : { kind: "stay" };
  return activeIndex >= focusableCount - 1 ? { kind: "wrap-first" } : { kind: "stay" };
}