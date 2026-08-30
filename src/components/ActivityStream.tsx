"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import Panel from "./Panel";
import { VirtualizedList } from "./virtual/VirtualizedList";
import { partitionNew } from "@/lib/virtual/window";

interface Entry { ts: number; agent: string; text: string; level?: string; }

// Entries carry no stable id, but the server returns a monotonic chronological
// log where ts (ms) is effectively unique per row. Keying by ts — instead of the
// old `ts-index` composition — stops a prepended event from shifting every later
// row's key and re-animating the whole list on each poll.
const entryKey = (e: Entry) => e.ts;

export default function ActivityStream({ embedded = false }: { embedded?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  // Keys seen so far; rows that appear for the FIRST time this poll animate once,
  // already-present rows render statically (no per-poll whole-list re-animation).
  const seenRef = useRef<Set<number>>(new Set());
  const [newKeys, setNewKeys] = useState<ReadonlySet<number>>(new Set());
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stop = false;
    const fetchIt = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        const j = await r.json();
        if (stop) return;
        const next = (j.entries ?? []) as Entry[];
        setEntries(next);
        const { addedKeys, newItems } = partitionNew(seenRef.current, next, (e) => e.ts);
        for (const k of addedKeys) seenRef.current.add(Number(k));
        setNewKeys(newItems.length ? new Set(newItems.map((e) => e.ts)) : new Set());
      } catch { /* ignore */ }
    };
    fetchIt();
    const t = setInterval(fetchIt, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Height estimate for the windowing offset table. Rows are a single packed
  // line that can wrap; estimate by content length (generous so rows rarely get
  // clipped), saturating at a cap so the table stays proportional for long text.
  // ponytail: estimate, not measurement — exact wrap height depends on the real
  // viewport width; switch to a measured table if tall rows ever clip at scale.
  const estimateRowHeight = useMemo(() => (e: Entry) => {
    const base = 34; // padding + py-1.5 + border
    const chars = e.text.length;
    return base + (chars > 90 ? Math.min(Math.ceil(chars / 90) * 14, 84) : 0);
  }, []);

  const dot = (a: string) =>
    a === "openclaw" ? "text-[var(--openclaw)]" :
    a === "hermes" ? "text-[var(--hermes)]" :
    "text-[var(--claude)]";

  return (
    <Panel
      title="Activity Stream"
      accent="system"
      icon={<Radio size={14} />}
      actions={
        <span className="pill pill-info">
          <span className="heartbeat" /> {entries.length} events
        </span>
      }
      className={embedded ? "min-h-[380px]" : "min-h-[460px]"}
    >
      <VirtualizedList<Entry>
        items={entries}
        getKey={entryKey}
        estimateRowHeight={estimateRowHeight}
        ariaLabel="Activity stream"
        threshold={30}
        className="scroll stream-fade overflow-y-auto h-full min-h-0 pr-2"
        style={{ height: "100%" }}
        plainHeight="fill"
        containerTestId="activity-viewport"
        rowTestId="activity-row"
        stickToBottom
        scrollRef={viewportRef}
        emptyContent={
          <div className="text-sm text-[var(--fg-dim)]">
            No log activity yet. Streams from <code>~/.openclaw/logs</code> and <code>~/.hermes/cache</code> appear here.
          </div>
        }
        renderItem={({ item: e }) => {
          const isNew = newKeys.has(e.ts);
          const rowClass =
            "flex gap-2 py-1.5 text-[11.5px] font-[var(--font-geist-mono)] border-b border-[rgba(255,255,255,0.04)] last:border-0";
          const inner = (
            <>
              <span className={`${dot(e.agent)} shrink-0`}>●</span>
              <span className="text-[var(--fg-dimmer)] shrink-0">
                {new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })}
              </span>
              <span className="text-[var(--fg-dim)] uppercase shrink-0 w-16 truncate">{e.agent}</span>
              <span className={`${
                e.level === "err" ? "text-rose-300" :
                e.level === "warn" ? "text-amber-300" :
                "text-[var(--fg-dim)]"
              } truncate`}>
                {e.text}
              </span>
            </>
          );
          // Only newly-arrived rows animate; everything else renders a static row
          // so a poll never re-animates rows that were already on screen.
          if (isNew) {
            return (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className={rowClass}
              >
                {inner}
              </motion.div>
            );
          }
          return <div className={rowClass}>{inner}</div>;
        }}
      />
    </Panel>
  );
}