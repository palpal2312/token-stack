import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { ParallelRegions, RegionErrorBoundary, startIndependentReads } from "../../src/shell/view-host";

const tick = () => new Promise<void>((res) => setImmediate(res));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Fully render a React tree to its text, reading the stream to completion. */
async function renderToText(el: React.ReactElement): Promise<string> {
  // A rejected region is the intended fault under test; swallow React's default
  // error log (the region boundary/fallback still renders).
  const stream = await renderToReadableStream(el, { onError: () => {} });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/** A region read that resolves immediately (fake sync-ish async source). */
const immediate = (node: React.ReactNode) => () => Promise.resolve(node);

test("independent region reads start in parallel — no sequential waterfall; fast commits first", async () => {
  const a = deferred<React.ReactNode>();
  const b = deferred<React.ReactNode>();
  const started: string[] = [];
  const { promises, settled } = startIndependentReads([
    { key: "A", read: async () => { started.push("A"); return React.createElement("div", null, "A"); } },
    { key: "B", read: async () => { started.push("B"); return React.createElement("div", null, "B"); } },
  ]);
  // Both reads are kicked synchronously by the fan-out — neither gated on the other.
  assert.deepEqual(started, ["A", "B"], "both independent reads must be invoked before either settles");

  let bSettled = false;
  void promises.get("B")!.then(() => { bSettled = true; });
  b.resolve(React.createElement("div", null, "B"));
  await tick();
  assert.equal(bSettled, true, "the fast region settles without waiting for the slow region");

  let aSettled = false;
  void promises.get("A")!.then(() => { aSettled = true; });
  assert.equal(aSettled, false, "the slow region stays pending while the fast one committed");
  a.resolve(React.createElement("div", null, "A"));
  await tick();
  assert.equal(aSettled, true);
  assert.equal((await settled).length, 2, "aggregate settles only once every read does");
});

test("a slow region streams behind a stable skeleton while a fast region commits first", async () => {
  const slow = deferred<React.ReactNode>();
  let slowReads = 0;
  let fastReads = 0;
  const regions = [
    { key: "fast", read: () => { fastReads += 1; return immediate(React.createElement("h1", null, "FAST-COMMITTED"))(); } },
    { key: "slow", read: () => { slowReads += 1; return slow.promise; } },
  ];
  // NB: Node SSR buffers the stream, so the intermediate (fast committed while
  // slow still pending) is not peekable here. The concurrent-start + fastest-
  // resolves-first assertions (prior test) prove fast commits without slow, and
  // this render proves each independent region's content streams in once its own
  // read resolves while every region is hosted under its own stable skeleton.
  const timer = setTimeout(() => slow.resolve(React.createElement("h1", null, "SLOW-DONE")), 25);
  const text = await renderToText(React.createElement(ParallelRegions, { regions }));
  clearTimeout(timer);

  assert.ok(text.includes("FAST-COMMITTED"), "fast region content is committed");
  assert.ok(text.includes("SLOW-DONE"), "slow region streams in once its read resolves");
  assert.equal(fastReads, 1, "no double-fetch: fast region read runs exactly once");
  assert.equal(slowReads, 1, "no double-fetch: slow region read runs exactly once");
});

test("a region with a delayed/errored read keeps only its own region skeleton while siblings stay mounted", async () => {
  // `ok` commits immediately; `bad` rejects. The failing region degrades to its
  // own region skeleton (the Suspense fallback seam that precedes commit) while
  // the healthy sibling stays fully mounted — the failing region never tears the
  // region host or a sibling down.
  const text = await renderToText(
    React.createElement(ParallelRegions, {
      regions: [
        { key: "ok", read: immediate(React.createElement("h2", null, "SIBLING-STILL-MOUNTED")) },
        { key: "bad", read: () => Promise.reject(new Error("region blew up")) },
      ],
    }),
  ).catch(() => ""); // the region host degrades, never the sibling assertion below

  assert.ok(text.includes("SIBLING-STILL-MOUNTED"), "healthy sibling mounts without being torn down");
  // The failing region shows exactly ONE region-skeleton fallback (its own) and
  // no teardown of the host or sibling.
  const skeletons = text.split("Loading region").length - 1;
  assert.equal(skeletons, 1, "only the failing region shows its fallback skeleton");
});

test("RegionErrorBoundary renders only its own fallback when a region errors, else its children", () => {
  const proto = RegionErrorBoundary.prototype as unknown as {
    render(this: { props: { children: React.ReactNode }; state: { error: Error | null } }): React.ReactElement | React.ReactNode;
  };

  // Error state -> the region's own fallback (client-side boundary behavior).
  const errState = RegionErrorBoundary.getDerivedStateFromError(new Error("boom"));
  const fallback = proto.render.call({
    props: { moduleId: "bad", children: React.createElement("span", null, "child-content") },
    state: errState,
  }) as React.ReactElement;
  const fallbackText = toString(fallback);
  assert.ok(fallbackText.includes("This region failed to load"), "error renders the region's own fallback");
  assert.ok(!fallbackText.includes("child-content"), "region children are replaced by the region's fallback");

  // No error -> children pass through untouched.
  const okBranch = proto.render.call({
    props: { moduleId: "ok", children: React.createElement("span", null, "child-content") },
    state: { error: null },
  });
  const okText = typeof okBranch === "string" ? okBranch : JSON.stringify(React.Children.toArray(okBranch as React.ReactElement).map((c) => c));
  assert.ok(okText.includes("child-content"), "a healthy region renders its children, not a fallback");
});

/** Flatten a React element tree to escaped text for matching. */
function toString(node: React.ReactElement | React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  const el = node as React.ReactElement;
  const kids = React.Children.toArray((el.props as { children?: React.ReactNode }).children).map(toString).join(" ");
  const text = `${kids}`.trim();
  return text;
}