import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAnimation,
  shouldKeepAnimating,
  elementVisible,
} from "../../src/shell/animation-classify";

test("animation-classify: infinite rAF runs only while visible, without reduced-motion", () => {
  const running = classifyAnimation({ visible: true, reducedMotion: false, kind: "infinite-rAF" });
  assert.equal(running, "run");
  assert.equal(shouldKeepAnimating(running), true);
});

test("animation-classify: hidden infinite animation pauses", () => {
  const hidden = classifyAnimation({ visible: false, reducedMotion: false, kind: "infinite-rAF" });
  assert.equal(hidden, "pause-hidden");
  assert.equal(shouldKeepAnimating(hidden), false);
});

test("animation-classify: reduced-motion zeroes infinite animation regardless of visibility", () => {
  const offVisible = classifyAnimation({ visible: true, reducedMotion: true, kind: "infinite-rAF" });
  const offHidden = classifyAnimation({ visible: false, reducedMotion: true, kind: "infinite-rAF" });
  const offKey = classifyAnimation({ visible: true, reducedMotion: true, kind: "infinite-keyframes" });
  assert.equal(offVisible, "motion-off");
  assert.equal(offHidden, "motion-off");
  assert.equal(offKey, "motion-off");
  assert.equal(shouldKeepAnimating(offVisible), false);
});

test("animation-classify: bounded one-shot / transition animations always run", () => {
  for (const kind of ["one-shot", "transition"] as const) {
    assert.equal(classifyAnimation({ visible: false, reducedMotion: true, kind }), "run");
    assert.equal(classifyAnimation({ visible: true, reducedMotion: false, kind }), "run");
  }
});

test("elementVisible: element is animated-visible only when shown AND intersecting", () => {
  assert.equal(elementVisible(true, true), true);
  assert.equal(elementVisible(false, true), false); // hidden tab/panel
  assert.equal(elementVisible(true, false), false); // scrolled out of view
  assert.equal(elementVisible(false, false), false);
});