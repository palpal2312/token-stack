"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

// Execution-mode preference (phase 12 step 11): the user picks Direct / No
// Sandbox or AgentENV Sandbox; SEN explains the impact in product language
// and persists the workspace preference through the Go control plane.
// Hidden when the Go plane is offline.

interface Preference {
  requestedMode: string;
  modeLabel: string;
}

const MODES = [
  {
    id: "host",
    label: "Direct / No Sandbox",
    hint: "Builders run directly on this machine. Fast, no isolation — for work you trust.",
  },
  {
    id: "agentenv",
    label: "AgentENV Sandbox",
    hint: "Builders run inside the isolated AgentENV sandbox. Slower to start; for risky or untrusted work.",
  },
] as const;

export default function ExecutionModePicker() {
  const [pref, setPref] = useState<Preference | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sen/execution-preference", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) return;
      setAvailable(body.available === true);
      setPref(body.preference ?? null);
    } catch { /* offline — stay hidden */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const choose = async (mode: string) => {
    if (busy || pref?.requestedMode === mode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setPref(body.preference ?? null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  const current = MODES.find((mode) => mode.id === pref?.requestedMode) ?? MODES[0];

  return (
    <div className="flex items-center gap-2 text-[11px]" title={current.hint}>
      <ShieldCheck size={12} style={{ color: current.id === "agentenv" ? "#86efac" : "var(--fg-dim)" }} />
      <select
        value={current.id}
        disabled={busy}
        onChange={(event) => void choose(event.target.value)}
        className="rounded-md border bg-transparent px-1.5 py-1 text-[11px] outline-none disabled:opacity-50"
        style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
        aria-label="Execution mode"
      >
        {MODES.map((mode) => (
          <option key={mode.id} value={mode.id} title={mode.hint}>{mode.label}</option>
        ))}
      </select>
      {error && <span style={{ color: "#fb7185" }}>{error}</span>}
    </div>
  );
}
