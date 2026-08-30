"use client";

import { useEffect, useRef, useState } from "react";
import { useNavPending } from "@/context/nav-pending-context";
import { navProgressLiveText } from "./live-region-text";

/**
 * Navigation progress (Phase 19a U1).
 *
 * An indeterminate progress affordance driven by the existing nav-pending state
 * (see `src/context/nav-pending-context.tsx`). It gives feedback in the same
 * frame a navigation starts, completes with a short "settled" beat, then fully
 * unmounts — there is no perpetual hidden animation running when idle, and the
 * reduced-motion path has zero animation. Stale/superseded pending targets are
 * treated as settled by the pure transition below.
 */

export type NavProgressState = "idle" | "active" | "settled";

/**
 * Pure state transition for the affordance.
 *
 * - A pending target that differs from the settled pathname → `active`.
 * - A settled target (or none) while previously `active` → `settled`.
 * - A settled target while `settled` → held by callers; after any settle, idle.
 * - A fresh pending target on top of `settled` → `active` again.
 */
export function nextNavProgressState(
  prev: NavProgressState,
  pendingHref: string | null,
  settledPathname: string,
): NavProgressState {
  const inflight = pendingHref !== null && pendingHref !== settledPathname;
  if (inflight) return "active";
  if (prev === "active") return "settled";
  return "idle";
}

const NAV_PROGRESS_CSS = `
.nav-progress-bar{height:3px;width:100%;will-change:transform;transform-origin:0 50%;
  background:linear-gradient(90deg,var(--gold),#7dd3fc);
  animation:nav-progress-indeterminate 1.2s ease-in-out infinite;}
@keyframes nav-progress-indeterminate{
  0%{transform:translateX(-100%) scaleX(0.35)}
  50%{transform:translateX(-20%) scaleX(0.5)}
  100%{transform:translateX(100%) scaleX(0.35)}}
.nav-progress-settled{animation:none;transform:none;transition:opacity .25s ease-out;}
.nav-progress-live{
  position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}
@media (prefers-reduced-motion: reduce){
  .nav-progress-bar{animation:none;}
  .nav-progress-settled{transition:none;}}
@media (forced-colors: active){
  .nav-progress-bar{background:Highlight;}
  .nav-progress-bar.nav-progress-settled{background:CanvasText;}}
`;

/** Settled beat before the affordance unmounts. */
const SETTLED_MS = 400;

export function NavigationProgress() {
  const { isPending, pendingHref, pathname } = useNavPending();
  const [state, setState] = useState<NavProgressState>("idle");
  const [announce, setAnnounce] = useState<string>("");
  const prevStateRef = useRef<NavProgressState>("idle");

  useEffect(() => {
    setState((s) => {
      // Hold the completed "settled" beat until its unmount timer fires.
      if (isPending === false && s === "settled") return s;
      return nextNavProgressState(s, isPending ? pendingHref : null, pathname);
    });
  }, [isPending, pendingHref, pathname]);

  // Announce only on the real transitions: entering "active" says the route is
  // loading; leaving "active" (to settled/idle) says we arrived at the settled
  // route. A settled view is never re-announced on unrelated renders.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === "active" && state !== "active") {
      setAnnounce(navProgressLiveText("arrived", pathname));
    } else if ((prev === "idle" || prev === "settled") && state === "active") {
      setAnnounce(navProgressLiveText("start", pendingHref ?? pathname));
    }
  }, [state, pendingHref, pathname]);

  useEffect(() => {
    if (state !== "settled") return;
    const t = setTimeout(() => setState("idle"), SETTLED_MS);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <>
      <style>{NAV_PROGRESS_CSS}</style>
      {/* Persistent polite live region — announces nav start/arrival to screen
          readers without any visual footprint. */}
      <div role="status" aria-live="polite" className="nav-progress-live">{announce}</div>
      {state !== "idle" && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] overflow-hidden"
          role={state === "active" ? "progressbar" : undefined}
          aria-label="Navigation in progress"
          aria-hidden={state === "active" ? undefined : true}
        >
          <div className={state === "settled" ? "nav-progress-bar nav-progress-settled" : "nav-progress-bar"} />
        </div>
      )}
    </>
  );
}