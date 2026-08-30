"use client";

import { createContext, useContext } from "react";

/**
 * Tiny SEN surface-context seam (budget fix: stops the default SEN chunk from
 * statically importing the whole sen-surface-coordinator graph).
 *
 * This module exposes ONLY the surface state type, the shared context, and a
 * default inert value so `useSenSurface` resolves without the coordinator. The
 * real `SenSurfaceCoordinator` provides the real context (same instance) when
 * active; when no provider is mounted (legacy Shell, or the coordinator flag
 * OFF) `useSenSurface` returns this default and composers behave as before.
 */

/** SEN surface choices. */
export type SenSurface = "page" | "side-panel" | "floating" | "none";

/** Which surface owns the interactive composer (single owner). */
export type SenComposerOwner = "page" | "side-panel" | "floating" | null;

/** The SEN surface authority shared by the coordinator provider and consumers. */
export interface SenSurfaceValue {
  surface: SenSurface;
  /** Derived: which surface owns the interactive composer (single owner). */
  composerOwner: SenComposerOwner;
  activeSessionId: string | null;
  setSurface: (surface: SenSurface) => void;
  setActiveSession: (sessionId: string | null) => void;
  /** Per-session continuity — preserved across surface switches. */
  saveDraft: (sessionId: string, draft: string) => void;
  draft: (sessionId: string) => string;
  saveScrollAnchor: (sessionId: string, anchor: number) => void;
  scrollAnchor: (sessionId: string) => number;
  setReturnFocus: (target: string | null) => void;
}

/** Inert default when no coordinator provider is mounted (legacy / flag OFF). */
export const DEFAULT_SEN_SURFACE_VALUE: SenSurfaceValue = {
  surface: "page",
  composerOwner: null,
  activeSessionId: null,
  setSurface: () => {},
  setActiveSession: () => {},
  saveDraft: () => {},
  draft: () => "",
  saveScrollAnchor: () => {},
  scrollAnchor: () => 0,
  setReturnFocus: () => {},
};

/**
 * Shared context. The default value is the inert surface, so a consumer that
 * reads the context with no provider mounted gets the same inert behavior —
 * no `useSenSurface` call can hold a runtime reference to the coordinator.
 */
export const SenSurfaceContext = createContext<SenSurfaceValue>(DEFAULT_SEN_SURFACE_VALUE);

/** Read the SEN surface authority; inert default when no provider is mounted. */
export function useSenSurface(): SenSurfaceValue {
  return useContext(SenSurfaceContext);
}