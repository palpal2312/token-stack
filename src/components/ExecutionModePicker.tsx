"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

interface Preference {
  requestedMode: "host" | "agentenv";
  modeLabel?: string;
  effectiveMode?: "host" | "agentenv";
  resolutionReason?: string;
}

function normalizePreference(value: unknown): Preference | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const requestedMode = raw.requestedMode ?? raw.requested_mode;
  if (requestedMode !== "host" && requestedMode !== "agentenv") return null;
  const effectiveMode = raw.effectiveMode ?? raw.effective_mode;
  return {
    requestedMode,
    modeLabel: typeof raw.modeLabel === "string" ? raw.modeLabel : undefined,
    effectiveMode: effectiveMode === "host" || effectiveMode === "agentenv" ? effectiveMode : undefined,
    resolutionReason: typeof (raw.resolutionReason ?? raw.resolution_reason) === "string"
      ? String(raw.resolutionReason ?? raw.resolution_reason)
      : undefined,
  };
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
  const [requestedUnavailable, setRequestedUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sen/execution-preference", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!body) return;
      if (res.status === 409 && body.requestedMode === "agentenv") {
        setAvailable(true);
        setRequestedUnavailable(true);
        setPref({ requestedMode: "agentenv" });
        setError(String(body.error ?? "AgentENV Sandbox is unavailable."));
        return;
      }
      if (!res.ok) return;
      setAvailable(body.available === true);
      setPref(normalizePreference(body.preference));
      setRequestedUnavailable(false);
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
      if (!res.ok) {
        const reasons = Array.isArray(body.reasonCodes) ? ` (${body.reasonCodes.join(", ")})` : "";
        if (res.status === 409 && body.requestedMode === "agentenv") {
          setAvailable(true);
          setRequestedUnavailable(true);
          setPref({ requestedMode: "agentenv" });
        }
        throw new Error(`${String(body.error ?? `HTTP ${res.status}`)}${reasons}`);
      }
      setPref(normalizePreference(body.preference));
      setRequestedUnavailable(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  const current = MODES.find((mode) => mode.id === pref?.requestedMode) ?? MODES[0];
  const effective = MODES.find((mode) => mode.id === pref?.effectiveMode);
  const explanation = pref?.effectiveMode && effective
    ? `Effective: ${effective.label}${pref.resolutionReason ? ` · ${pref.resolutionReason}` : ""}`
    : current.hint;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]" title={explanation}>
      <ShieldCheck size={12} style={{ color: current.id === "agentenv" ? "#86efac" : "var(--fg-dim)" }} />
      <span className="text-[var(--fg-dim)]">Execution</span>
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
      {(requestedUnavailable || (pref?.effectiveMode && pref.effectiveMode !== pref.requestedMode)) && (
        <span className="text-amber-300">Requested mode unavailable; choose Direct / No Sandbox to recover.</span>
      )}
      {error && <span style={{ color: "#fb7185" }}>{error}</span>}
    </div>
  );
}
