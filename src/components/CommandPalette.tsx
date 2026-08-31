"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { Sparkles, Box, Cpu, ChevronRight } from "lucide-react";
import { FOCUSABLE_SELECTOR, stepFocusTrap } from "@/shell/focus-trap";

interface Action {
  id: string;
  label: string;
  hint: string;
  agent: "claude" | "openclaw" | "hermes";
  args: string[];
}

const ACTIONS: Action[] = [
  { id: "oc-health",   label: "OpenClaw: health",   hint: "gateway + agent status", agent: "openclaw", args: ["health"] },
  { id: "oc-doctor",   label: "OpenClaw: doctor",   hint: "diagnostics + fixes", agent: "openclaw", args: ["doctor"] },
  { id: "oc-logs",     label: "OpenClaw: tail logs", hint: "gateway log tail", agent: "openclaw", args: ["logs"] },
  { id: "oc-agents",   label: "OpenClaw: list agents", hint: "all configured agents", agent: "openclaw", args: ["agents", "list"] },
  { id: "hm-status",   label: "Hermes: status",     hint: "env, model, keys", agent: "hermes", args: ["status"] },
  { id: "hm-doctor",   label: "Hermes: doctor",     hint: "config + dep check", agent: "hermes", args: ["doctor"] },
  { id: "hm-sessions", label: "Hermes: sessions",   hint: "list session history", agent: "hermes", args: ["sessions", "list"] },
  { id: "hm-skills",   label: "Hermes: skills",     hint: "installed skills", agent: "hermes", args: ["skills", "list"] },
  { id: "cl-version",  label: "Claude: version",    hint: "check claude --version", agent: "claude", args: ["--version"] },
];

const ICONS = {
  claude: <Sparkles size={14} className="text-[var(--claude)]" />,
  openclaw: <Box size={14} className="text-[var(--openclaw)]" />,
  hermes: <Cpu size={14} className="text-[var(--hermes)]" />,
};

export default function CommandPalette({
  showTrigger = true,
}: {
  /** Visible ⌘K button. Keyboard shortcut always works. */
  showTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ label: string; out: string } | null>(null);
  const [running, setRunning] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // a11y: opening captures the invoking element so closing can return focus;
  // closing restores it (the modal's composer short-circuit keeps a keyboard
  // user from being stranded at the body after Escape/click-away).
  const openWithReturnFocus = useCallback(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const closeWithReturnFocus = useCallback(() => {
    setOpen(false);
    prevFocusRef.current?.focus?.();
  }, []);

  // Keep Tab wrapped inside the modal while open (a pure-decision focus trap).
  const onDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    const step = stepFocusTrap(nodes.length, idx === -1 ? 0 : idx, e.shiftKey);
    if (step.kind === "wrap-first") {
      nodes[0]?.focus();
      e.preventDefault();
    } else if (step.kind === "wrap-last") {
      nodes[nodes.length - 1]?.focus();
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closeWithReturnFocus();
        else openWithReturnFocus();
      }
      if (e.key === "Escape" && open) closeWithReturnFocus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, openWithReturnFocus, closeWithReturnFocus]);

  async function execute(a: Action) {
    setRunning(true);
    setResult({ label: a.label, out: "running…" });
    try {
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: a.agent, args: a.args }),
      });
      const j = await r.json();
      setResult({ label: a.label, out: (j.stdout || "") + (j.stderr ? `\n${j.stderr}` : "") || "(no output)" });
    } catch (e) {
      setResult({ label: a.label, out: String(e) });
    }
    setRunning(false);
  }

  return (
    <>
      {showTrigger && (
        <button
          onClick={openWithReturnFocus}
          aria-haspopup="dialog"
          className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--panel-border)] text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--panel-border-hot)] transition"
        >
          <span>⌘K</span><span>Command palette</span>
        </button>
      )}

      <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-start pt-[12vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-sm"
            onClick={closeWithReturnFocus}
          >
            <motion.div
              initial={{ y: -16, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={onDialogKeyDown}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              ref={dialogRef}
              className="panel panel-hot w-[min(640px,92vw)] mx-auto overflow-hidden"
            >
              <Command label="Command palette" loop>
                <Command.Input
                  className="cmdk-input"
                  placeholder="Run a command across your agents…"
                  autoFocus
                />
                <div className="border-t border-[var(--panel-border)] p-2 max-h-[50vh] overflow-y-auto scroll">
                  <Command.Empty className="px-4 py-3 text-sm text-[var(--fg-dim)]">
                    No commands found.
                  </Command.Empty>
                  <Command.Group heading="Commands" className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] px-2 py-1">
                    {ACTIONS.map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`${a.label} ${a.hint}`}
                        onSelect={() => execute(a)}
                        className="cmdk-item"
                      >
                        {ICONS[a.agent]}
                        <span className="flex-1 text-sm text-[var(--fg)]">{a.label}</span>
                        <span className="text-[11px] text-[var(--fg-dimmer)]">{a.hint}</span>
                        <ChevronRight size={12} className="opacity-50" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                </div>

                {result && (
                  <div className="border-t border-[var(--panel-border)] p-3 bg-[rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1">
                      {running ? "running" : "result"} · {result.label}
                    </div>
                    <pre className="scroll max-h-[200px] overflow-auto text-[11px] font-[var(--font-geist-mono)] text-[var(--fg-dim)] whitespace-pre">
                      {result.out}
                    </pre>
                  </div>
                )}
              </Command>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </MotionConfig>
    </>
  );
}
