import assert from "node:assert/strict";
import test from "node:test";

import {
  SEN_SURFACE_SCHEMA_VERSION,
  composerOwnerFor,
  createMemorySenSurfaceStorage,
  createSenSurfaceStore,
  migrateSenSurfaceState,
} from "../../src/shell/sen-surface-store";
import {
  PANEL_MIN_SIZE,
  PANEL_MAX_SIZE,
  clampPanelSize,
  clampPanelSizeToContainer,
  createMemoryPanelStorage,
  createPanelLayoutStore,
  nextPanelPhase,
} from "../../src/shell/panel-layout-store";
import {
  createPanelResizeController,
  fixedBounds,
  type PanelResizeController,
  type ResizeScheduler,
} from "../../src/shell/panel-resize-controller";
// Importing the coordinator module confirms it (and its raw React/next imports)
// loads under the tsx runner without breaking the type graph.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import SenSurfaceCoordinator from "../../src/shell/sen-surface-coordinator";

function makeSurfaceStore() {
  const storage = createMemorySenSurfaceStorage();
  const store = createSenSurfaceStore({ storage });
  return { storage, store };
}

function makeStore() {
  const storage = createMemoryPanelStorage();
  const store = createPanelLayoutStore({ storage });
  return { storage, store };
}

/** A queue-based fake rAF scheduler: callbacks run only when drained. */
function makeQueueScheduler() {
  const queue: (() => void)[] = [];
  const scheduler: ResizeScheduler = (fn) => queue.push(fn);
  return { scheduler, queue, drain: () => { while (queue.length) queue.shift()!(); } };
}

/** Build a controller that counts DOM writes and persisted commits. */
function makeController(
  bounds: { min: number; max: number; containerSize: number },
  opts: { onSizeHook?: (c: PanelResizeController) => void } = {},
) {
  let writes = 0;
  let commits = 0;
  const written: number[] = [];
  const committed: number[] = [];
  const { scheduler, drain } = makeQueueScheduler();
  const c = createPanelResizeController({
    onSize: (size) => {
      writes += 1;
      written.push(size);
      opts.onSizeHook?.(c);
    },
    onCommit: (size) => {
      commits += 1;
      committed.push(size);
    },
    bounds: () => bounds,
    schedule: scheduler,
  });
  return { c, writes: () => writes, commits: () => commits, written, committed, drain };
}

// ------------------------------------------------------------------ surface

test("sen surface store: page suppresses contextual composer; ONE owner at a time", () => {
  const { store } = makeSurfaceStore();
  assert.equal(store.surface("ws"), "page");
  assert.equal(store.composerOwner("ws"), "page", "page owns the composer");

  store.setSurface("ws", "side-panel");
  assert.equal(store.surface("ws"), "side-panel");
  assert.equal(store.composerOwner("ws"), "side-panel", "side-panel is the single owner");

  store.setSurface("ws", "floating");
  assert.equal(store.composerOwner("ws"), "floating");

  store.setSurface("ws", "page");
  assert.equal(store.composerOwner("ws"), "page", "back to page — side/floating suppressed");
});

test("sen surface store: switching surface keeps canonical session + draft + scroll anchor", () => {
  const { store } = makeSurfaceStore();
  store.setActiveSession("ws", "s-abc");
  store.saveDraft("ws", "s-abc", "hello sen");
  store.saveScrollAnchor("ws", "s-abc", 412);

  store.setSurface("ws", "side-panel");
  assert.equal(store.surface("ws"), "side-panel");
  assert.equal(store.getSnapshot("ws").activeSessionId, "s-abc", "session preserved on switch");
  assert.equal(store.draft("ws", "s-abc"), "hello sen", "draft preserved on switch");
  assert.equal(store.scrollAnchor("ws", "s-abc"), 412, "scroll anchor preserved on switch");

  store.setSurface("ws", "floating");
  assert.equal(store.getSnapshot("ws").activeSessionId, "s-abc");
  assert.equal(store.draft("ws", "s-abc"), "hello sen");
  assert.equal(store.scrollAnchor("ws", "s-abc"), 412);
});

test("sen surface store: per-session drafts are independent; empty clears them", () => {
  const { store } = makeSurfaceStore();
  store.saveDraft("ws", "s-1", "one");
  store.saveDraft("ws", "s-2", "two");
  assert.equal(store.draft("ws", "s-1"), "one");
  assert.equal(store.draft("ws", "s-2"), "two");
  store.saveDraft("ws", "s-1", "");
  assert.equal(store.draft("ws", "s-1"), "", "empty draft clears");
  assert.equal(store.draft("ws", "s-2"), "two", "other session's draft untouched");
});

test("sen surface store: migration self-heals corrupt/future records and keeps secret-free", () => {
  const seeded: Record<string, unknown> = {
    "workspace:ws": {
      surface: "side-panel",
      activeSessionId: "s-1",
      drafts: { "s-1": "kept", junk: 42 },
      scrollAnchors: { "s-1": 99, bad: "nope" },
      schemaVersion: 99,
      apiToken: "SECRET", // must be stripped — secret-free contract
    },
    "workspace:junk": "garbage",
  };
  const storage = createMemorySenSurfaceStorage();
  storage.writeAll(seeded as unknown as never);
  const store = createSenSurfaceStore({ storage });

  const migrated = store.getSnapshot("ws");
  assert.equal(migrated.schemaVersion, SEN_SURFACE_SCHEMA_VERSION);
  assert.equal(migrated.surface, "side-panel");
  assert.equal(migrated.drafts["s-1"], "kept");
  assert.equal((migrated as unknown as Record<string, unknown>).apiToken, undefined, "no secret round-trips");
  const junk = store.getSnapshot("junk");
  assert.equal(junk.surface, "page", "corrupt entry falls back to safe default");
  assert.equal(junk.activeSessionId, null);
});

test("sen surface store: per-workspace isolation and clearWorkspace scoping", () => {
  const { storage, store } = makeSurfaceStore();
  store.setSurface("alice", "floating");
  store.setActiveSession("bob", "s-bob");
  assert.equal(store.surface("alice"), "floating");
  assert.equal(store.surface("bob"), "page", "workspaces share no surface state");

  store.clearWorkspace("alice");
  assert.equal(store.stateCount(), 1);
  assert.equal(store.surface("alice"), "page", "cleared workspace self-heals to default");
});

test("composerOwnerFor: only composer surfaces yield a non-null owner", () => {
  assert.equal(composerOwnerFor("page"), "page");
  assert.equal(composerOwnerFor("side-panel"), "side-panel");
  assert.equal(composerOwnerFor("floating"), "floating");
  assert.equal(composerOwnerFor("none"), null);
});

// -------------------------------------------------------------- panel phases

test("panel state machine: closed -> opening -> open -> resizing -> open -> closing -> closed", () => {
  assert.equal(nextPanelPhase("closed", "open"), "opening");
  assert.equal(nextPanelPhase("opening", "settle"), "open");
  assert.equal(nextPanelPhase("open", "resize"), "resizing");
  assert.equal(nextPanelPhase("resizing", "open"), "open", "drag end returns to open");
  assert.equal(nextPanelPhase("open", "close"), "closing");
  assert.equal(nextPanelPhase("closing", "settle"), "closed");
});

test("panel state machine: rapid open->close->resize->open lands on ONE target", () => {
  // Interruption determinism: every interruption resolves to exactly one final
  // phase; the machine never blocks mid-resize or on a stale transition.
  let p = nextPanelPhase("closed", "open");   // opening
  p = nextPanelPhase(p, "close");             // closing (interrupt the open)
  p = nextPanelPhase(p, "resize");            // resize while closing -> no-op
  p = nextPanelPhase(p, "open");              // reversal -> opening
  p = nextPanelPhase(p, "settle");            // advance to terminal
  assert.equal(p, "open", "lands deterministically on open");
});

test("panel state machine: interrupt target is deterministic / resize only while open", () => {
  // open -> close -> close (idempotent) -> settle -> closed
  let p = nextPanelPhase("open", "close");
  assert.equal(nextPanelPhase(p, "close"), "closing");
  assert.equal(nextPanelPhase(p, "settle"), "closed");

  // resize while not open is a no-op (no stuck "resizing" during a close)
  assert.equal(nextPanelPhase("closing", "resize"), "closing");
  assert.equal(nextPanelPhase("closed", "resize"), "closed");
  assert.equal(nextPanelPhase("open", "resize"), "resizing");
});

test("panel state machine: reduced-motion gives zero transition delay", () => {
  assert.equal(nextPanelPhase("closed", "open", true), "open", "no opening phase");
  assert.equal(nextPanelPhase("open", "close", true), "closed", "no closing phase");
  assert.equal(nextPanelPhase("opening", "close", true), "closed");
  assert.equal(nextPanelPhase("closing", "open", true), "open");
});

test("panel store: applyPanelIntent drives visual phase and keeps logicalOpen in step", () => {
  const { store } = makeStore();
  const key = "ws::side";
  assert.equal(store.getPanelPhase("ws", "side"), "closed");
  assert.equal(store.getSnapshot(key).logicalOpen, false);

  assert.equal(store.applyPanelIntent("ws", "side", "open"), "opening");
  assert.equal(store.applyPanelIntent("ws", "side", "settle"), "open");
  assert.equal(store.getSnapshot(key).logicalOpen, true, "open settles logical visibility");

  assert.equal(store.applyPanelIntent("ws", "side", "close"), "closing");
  assert.equal(store.applyPanelIntent("ws", "side", "settle"), "closed");
  assert.equal(store.getSnapshot(key).logicalOpen, false, "close settles logical visibility");

  // Reduced-motion: open lands directly on open (zero transition delay).
  const { store: rm } = makeStore();
  assert.equal(rm.applyPanelIntent("ws", "side", "open", true), "open");
  assert.equal(rm.getPanelPhase("ws", "side"), "open");
});

// --------------------------------------------------------------- DPI / clamp

test("DPI clamp: restore above the container clamps down to the container", () => {
  assert.equal(clampPanelSizeToContainer(800, 400, PANEL_MIN_SIZE, PANEL_MAX_SIZE), 400);
  assert.equal(clampPanelSizeToContainer(5000, 720, 240, 720), 720, "container wider than max uses max");
  assert.equal(clampPanelSizeToContainer(500, 300, 240, 720), 300);
  assert.equal(clampPanelSizeToContainer(50, 400, 240, 720), 240, "min respected below container");
  assert.equal(clampPanelSizeToContainer(Number.NaN, 400, 240, 720), 240, "NaN to min");
});

// ------------------------------------------------------------ resize controller

test("rAF batching: N pointer moves -> 1 committed DOM write + 1 persisted commit", () => {
  const bounds = fixedBounds(240, 720, 2000);
  const { c, writes, commits, drain } = makeController(bounds);
  c.beginDrag(300, 1);
  for (let i = 0; i < 50; i++) c.updateDrag(400 + i, 300, 300);
  assert.equal(writes(), 0, "no DOM write until the frame flushes");
  drain();
  assert.equal(writes(), 1, "exactly one DOM write after the frame, not one per move");
  c.endDrag();
  assert.equal(commits(), 1, "exactly one persisted commit at drag end");
  assert.equal(writes(), 1, "drag end does not add a second write");
});

test("resize controller: no commit before drag end; drag end commits the applied size", () => {
  const bounds = fixedBounds(240, 720, 2000);
  const { c, writes, commits, committed, drain } = makeController(bounds);
  c.beginDrag(300, 7);
  c.updateDrag(480, 300, 300);
  assert.equal(commits(), 0, "no persistence mid-drag");
  drain();
  assert.equal(writes(), 1);
  c.endDrag();
  assert.equal(commits(), 1);
  assert.equal(committed[0], 480, "commit reflects the effective dragged size");
  assert.equal(c.pointerId(), null, "pointer released on drag end");
  assert.equal(c.isDragging(), false);
});

test("observer loop guard: observer firing during the controller's own write -> no re-entry", () => {
  const bounds = fixedBounds(240, 720, 2000);
  let resizeDuringWrite: boolean | null = null;
  let writes = 0;
  const queueScheduler = makeQueueScheduler();
  const c = createPanelResizeController({
    onSize: () => {
      writes += 1;
      // The ResizeObserver echoes synchronously while our own write is on the
      // stack — it must be ignored (loop guard), not schedule a second write.
      resizeDuringWrite = c.onContainerResize();
    },
    onCommit: () => {},
    bounds: () => bounds,
    schedule: queueScheduler.scheduler,
  });
  c.beginDrag(300, 1);
  c.updateDrag(360, 300, 300);
  queueScheduler.drain();
  assert.equal(writes, 1, "single write despite the observer echo");
  assert.equal(resizeDuringWrite, false, "observer notification during own write is ignored");
});

test("observer loop guard: idle re-clamp only writes when the container meaningfully changed", () => {
  const bounds = fixedBounds(240, 720, 2000);
  const { c, writes, drain } = makeController(bounds);
  c.onContainerResize();
  assert.equal(writes(), 0, "no write when nothing changed");

  // A container shrink below the applied size forces a re-clamp write.
  const tight = fixedBounds(240, 720, 2000);
  const { c: c2, writes: w2, drain: d2 } = makeController(tight);
  c2.beginDrag(500, 1);
  d2();
  c2.endDrag(); // applied = 500 while the container is 2000
  assert.equal(w2(), 1);
  tight.containerSize = 300; // container shrinks below the applied size
  const scheduled = c2.onContainerResize(); // clamp 500 -> 300
  assert.equal(scheduled, true, "idle observer re-clamps to the new container");
  d2();
  assert.equal(w2(), 2);
  assert.equal(c2.appliedSize(), 300);
});

test("keyboard resize: arrows/shift-arrows increment clamped on a focusable edge", () => {
  const bounds = fixedBounds(240, 720, 2000);
  const { c, written, committed } = makeController(bounds);
  const fine = c.keyboardStep(500, 1, false);
  assert.equal(fine, 540, "arrow step +40, clamped");
  assert.equal(written[written.length - 1], 540);
  assert.equal(committed[committed.length - 1], 540, "a keyboard step is an intentional commit");

  const coarse = c.keyboardStep(600, 1, true);
  assert.equal(coarse, 720, "shift-arrow step +160 clamped to max");

  const down = c.keyboardStep(400, -1, true);
  assert.equal(down, 240, "shift-up arrow clamped to min");

  // Never past the live container ceiling: a +40 step from 280 would land 320,
  // which is clamped down to the 300px container.
  const tiny: { min: number; max: number; containerSize: number } = { min: 240, max: 720, containerSize: 300 };
  const { c: c2, written: w2 } = makeController(tiny);
  const clamped = c2.keyboardStep(280, 1, false);
  assert.equal(clamped, 300, "keyboard step cannot exceed the live container");

  assert.equal(clampPanelSize(700, 240, 720), 700, "plain clamp unaffected");
});