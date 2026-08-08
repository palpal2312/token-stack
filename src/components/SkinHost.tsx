"use client";

// Renders a built-in skin's original view, unchanged.
//
// An agent wearing a built-in skin has to behave exactly like its classic tab,
// and the surest way to guarantee that is to mount the very same component
// rather than a reimplementation that drifts. These views take no props and
// manage their own state, so there is nothing to thread through.

import GLMView from "./GLMView";
import OmniRouteView from "./OmniRouteView";
import Hy3CoderView from "./Hy3CoderView";
import FusionView from "./FusionView";
import SakanaView from "./SakanaView";
import LocalView from "./LocalView";

const VIEWS: Record<string, () => React.ReactElement> = {
  glm: GLMView,
  omniroute: OmniRouteView,
  "hy3-coder": Hy3CoderView,
  fusion: FusionView,
  sakana: SakanaView,
  local: LocalView,
};

export function hasBuiltinView(skinId: string): boolean {
  return skinId in VIEWS;
}

export default function SkinHost({ skinId }: { skinId: string }) {
  const View = VIEWS[skinId];
  if (!View) {
    return (
      <div className="panel p-4 text-[13px]" style={{ color: "var(--fg-dim)" }}>
        The <span className="metric">{skinId}</span> skin has no built-in view to render.
      </div>
    );
  }
  return <View />;
}
