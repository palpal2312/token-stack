/**
 * Phase 19a U4 hidden / reduced-motion animation policy (pure).
 *
 * A hidden or infinite animated element must not run rAF/keyframes while not
 * visible, and reduced-motion users get zero animation. This module is the pure
 * classification a heavy animated component consults before starting / while
 * running its animation loop. No DOM, no browser globals.
 */

export type AnimationKind =
  | "infinite-rAF"
  | "infinite-keyframes"
  | "one-shot"
  | "transition";

export type AnimationVerdict =
  | "run"
  | "pause-hidden"
  | "motion-off";

/**
 * Decide whether an animation may run.
 *
 * - one-shot / transition: always run (they are bounded, not hidden loops).
 * - infinite-rAF / infinite-keyframes: hot path — under reduced-motion the
 *   animation is OFF entirely (zero motion); otherwise it runs only while the
 *   element is actually visible (pause when hidden).
 */
export function classifyAnimation(opts: {
  visible: boolean;
  reducedMotion: boolean;
  kind: AnimationKind;
}): AnimationVerdict {
  if (opts.kind === "one-shot" || opts.kind === "transition") return "run";
  if (opts.reducedMotion) return "motion-off";
  if (!opts.visible) return "pause-hidden";
  return "run";
}

/** Whether a "run" verdict must keep (true) the animation loop going. */
export function shouldKeepAnimating(verdict: AnimationVerdict): boolean {
  return verdict === "run";
}

/**
 * Resolve the effective visibility of an element, conflating the element's own
 * `IntersectionObserver` visibility with a software-`shown` flag (e.g. a hidden
 * tab/panel that is structurally present but not displayed). An element is
 * "visible" for animation purposes only when both are true.
 */
export function elementVisible(ancestorShown: boolean, intersection: boolean): boolean {
  return ancestorShown && intersection;
}