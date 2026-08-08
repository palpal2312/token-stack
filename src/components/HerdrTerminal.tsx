"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, SquareTerminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { apiFetch, apiWsUrl } from "@/lib/apiFetch";
import { HERDR_TERMINAL_WS_PATH } from "@/lib/herdrTerminalProtocol";

// The live Herdr window of the Code Space: a real PowerShell PTY (spawned by
// /api/herdr/terminal). After start/restart over HTTP, I/O rides a duplex
// WebSocket (binary PTY bytes + JSON resize). Requires `npm run dev` / `start`
// via server.ts so the upgrade is handled in-process.
//
// Renderer: default xterm.js (reliable for Herdr TUI). Opt into ghostty-web with
// ?term=ghostty or localStorage agentos.code-space.term=ghostty. Auto-falls
// back to xterm if ghostty WASM fails to init.

type Phase = "booting" | "live" | "error";
type TermBackend = "xterm" | "ghostty";

const TERM_STORAGE_KEY = "agentos.code-space.term";

const TERM_THEME = {
  background: "#120d17",
  foreground: "#f3ebda",
  cursor: "#d4a574",
  selectionBackground: "rgba(212, 165, 116, 0.30)",
} as const;

function resolveTermBackend(): TermBackend {
  if (typeof window === "undefined") return "xterm";
  try {
    const q = new URLSearchParams(window.location.search).get("term");
    if (q === "ghostty" || q === "xterm") {
      window.localStorage.setItem(TERM_STORAGE_KEY, q);
      return q;
    }
    const stored = window.localStorage.getItem(TERM_STORAGE_KEY);
    // Spike left many installs on ghostty; that path garbles Herdr's TUI today.
    // Only honor ghostty when the user explicitly asks via ?term=ghostty.
    if (stored === "ghostty") {
      window.localStorage.setItem(TERM_STORAGE_KEY, "xterm");
    }
  } catch { /* private mode / SSR */ }
  return "xterm";
}

/** Minimal surface shared by xterm and ghostty-web for this panel. */
interface TermLike {
  cols: number;
  rows: number;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array): void;
  dispose(): void;
  loadAddon(addon: { activate(terminal: TermLike): void; dispose(): void }): void;
  onData(listener: (data: string) => void): { dispose(): void } | void;
}

interface FitLike {
  fit(): void;
  dispose(): void;
  activate(terminal: TermLike): void;
}

type BackendMods = {
  Terminal: new (opts: object) => TermLike;
  FitAddon: new () => FitLike;
  ready: () => Promise<void>;
};

async function loadBackend(kind: TermBackend): Promise<BackendMods> {
  if (kind === "ghostty") {
    const mod = await import("ghostty-web");
    return {
      Terminal: mod.Terminal as unknown as new (opts: object) => TermLike,
      FitAddon: mod.FitAddon as unknown as new () => FitLike,
      ready: () => mod.init(),
    };
  }
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);
  return {
    Terminal: Terminal as unknown as new (opts: object) => TermLike,
    FitAddon: FitAddon as unknown as new () => FitLike,
    ready: async () => {},
  };
}

export default function HerdrTerminal({
  compact = false,
  fill = false,
  debugMode = false,
}: {
  compact?: boolean;
  /** Stretch to fill a flex parent (standalone Code Space). */
  fill?: boolean;
  /** Visual indicator for debug shell (bypasses projection authority). */
  debugMode?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("booting");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const [backend, setBackend] = useState<TermBackend>("xterm");

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let disposeTerm: (() => void) | null = null;
    let wsFailTimer: ReturnType<typeof setTimeout> | null = null;
    const utf8 = new TextEncoder();
    const utf8dec = new TextDecoder();

    async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
      const r = await apiFetch("/api/herdr/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      try { return await r.json(); } catch { return { error: `The server returned ${r.status}.` }; }
    }

    async function resolveMods(preferred: TermBackend): Promise<{ kind: TermBackend; mods: BackendMods; fellBack: boolean }> {
      try {
        const mods = await loadBackend(preferred);
        await mods.ready();
        return { kind: preferred, mods, fellBack: false };
      } catch (e) {
        if (preferred === "xterm") throw e;
        console.warn("[HerdrTerminal] ghostty-web failed; falling back to xterm", e);
        const mods = await loadBackend("xterm");
        await mods.ready();
        return { kind: "xterm", mods, fellBack: true };
      }
    }

    async function boot() {
      if (!disposed) setNotice(null);
      const preferred = resolveTermBackend();
      const { kind, mods, fellBack } = await resolveMods(preferred);
      if (!disposed) {
        setBackend(kind);
        if (fellBack) {
          setNotice("ghostty-web failed to load — using xterm.js. Fix WASM (/ghostty-vt.wasm) or use ?term=xterm.");
        }
      }
      if (disposed || !hostRef.current) return;

      const { Terminal, FitAddon } = mods;
      // Integer font size + ConPTY heuristics + no scrollback: FitAddon otherwise
      // reserves ~14px for a scrollbar and fractional fonts mis-count rows, which
      // is exactly the "footer overlapping status" garble Herdr/Claude TUIs show.
      const term = new Terminal({
        // Consolas first: always present on Windows with stable cell metrics.
        // Cascadia can load late and shift FitAddon row counts mid-session.
        fontFamily: "Consolas, Cascadia Mono, ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 1.0,
        letterSpacing: 0,
        cursorBlink: true,
        scrollback: 0,
        rescaleOverlappingGlyphs: true,
        windowsPty: { backend: "conpty", buildNumber: 22621 },
        theme: TERM_THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);

      let lastCols = 0;
      let lastRows = 0;
      const pushResize = (force = false) => {
        if (disposed) return;
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (cols < 2 || rows < 2) return;
        if (!force && cols === lastCols && rows === lastRows) return;
        lastCols = cols;
        lastRows = rows;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      };

      fit.fit();
      lastCols = term.cols;
      lastRows = term.rows;

      const startOp = restartTick > 0 ? "restart" : "start";
      const started = await post({ op: startOp, cols: term.cols, rows: term.rows });
      if (disposed) { term.dispose(); return; }
      if (started.error) {
        setErr(String(started.error));
        setPhase("error");
        term.dispose();
        return;
      }

      socket = new WebSocket(apiWsUrl(HERDR_TERMINAL_WS_PATH));
      socket.binaryType = "arraybuffer";

      const wsFailTimerLocal = setTimeout(() => {
        if (disposed || socket?.readyState === WebSocket.OPEN) return;
        setPhase("error");
        setErr("Terminal WebSocket did not connect. Restart the dashboard with npm run dev (custom server.ts), not next dev alone.");
      }, 2500);
      wsFailTimer = wsFailTimerLocal;

      socket.onopen = () => {
        clearTimeout(wsFailTimerLocal);
        if (!disposed) setPhase("live");
        // Always push size on connect (force): start may have reused a PTY that
        // was spawned at a different cols×rows than this viewport.
        requestAnimationFrame(() => {
          pushResize(true);
          void document.fonts?.ready?.then(() => { if (!disposed) pushResize(true); });
          setTimeout(() => { if (!disposed) pushResize(true); }, 250);
        });
      };
      socket.onerror = () => {
        clearTimeout(wsFailTimerLocal);
        if (!disposed) {
          setPhase("error");
          setErr("Lost the terminal WebSocket. Press Restart (dashboard must run via npm run dev / npm start).");
        }
      };
      socket.onclose = () => {
        clearTimeout(wsFailTimerLocal);
        if (disposed) return;
        setPhase((p) => (p === "error" ? p : "error"));
        setErr((e) => e ?? "Terminal WebSocket closed. Press Restart.");
      };
      socket.onmessage = (ev) => {
        if (disposed) return;
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data) as { type?: string; message?: string };
            if (msg.type === "error" && msg.message) {
              setErr(msg.message);
              setPhase("error");
            }
          } catch {
            term.write(ev.data);
          }
          return;
        }
        if (ev.data instanceof ArrayBuffer) {
          term.write(utf8dec.decode(ev.data));
        }
      };

      term.onData((data) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256_000) {
          if (!disposed) setNotice("Terminal input paused briefly (socket backlog). Keep typing after it clears.");
          return;
        }
        socket.send(utf8.encode(data));
      });

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (disposed) return;
          const prevC = lastCols;
          const prevR = lastRows;
          pushResize();
          // Also PATCH the PTY via HTTP when WS is not open yet (boot race).
          if ((!socket || socket.readyState !== WebSocket.OPEN) && (term.cols !== prevC || term.rows !== prevR)) {
            void post({ op: "resize", cols: term.cols, rows: term.rows });
          }
        }, 80);
      });
      if (hostRef.current) observer.observe(hostRef.current);

      disposeTerm = () => {
        observer.disconnect();
        if (resizeTimer) clearTimeout(resizeTimer);
        try { fit.dispose(); } catch { /* addon already gone */ }
        term.dispose();
      };
    }

    boot().catch((e) => {
      if (!disposed) { setErr(e instanceof Error ? e.message : String(e)); setPhase("error"); }
    });

    return () => {
      disposed = true;
      if (wsFailTimer) clearTimeout(wsFailTimer);
      try { socket?.close(); } catch { /* ignore */ }
      disposeTerm?.();
    };
  }, [restartTick]);

  return (
    <div className={`panel aura-border p-0 overflow-hidden flex flex-col min-h-0 ${fill ? "h-full" : ""} ${phase === "live" ? "aura-border--live" : ""}`}>
      <div className="px-3 py-2 border-b border-[var(--panel-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <SquareTerminal size={13} className="text-[var(--fg-dim)]" />
          <span className="text-[12px]">{debugMode ? "Debug Shell" : "Herdr session"}</span>
          {debugMode && (
            <span
              className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ background: "rgba(251,191,36,.15)", color: "#fbbf24" }}
              title="This shell bypasses projection authority"
            >
              ⚠ Debug
            </span>
          )}
          <span
            className="text-[10px] uppercase tracking-wide text-[var(--fg-dimmer)]"
            title="Terminal renderer (default xterm; ?term=ghostty to try Ghostty WASM)"
          >
            {backend} · ws
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: phase === "live" ? "#86efac" : phase === "error" ? "#fb7185" : "#d4a574" }}
            title={phase}
          />
        </div>
        <button
          onClick={() => { setErr(null); setNotice(null); setPhase("booting"); setRestartTick((t) => t + 1); }}
          className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)] transition"
        >
          <RefreshCw size={11} /> Restart
        </button>
      </div>
      {notice && <div className="px-3 py-2 text-[11px] text-amber-200/90 border-b border-[var(--panel-border)] shrink-0">{notice}</div>}
      {err && <div className="px-3 py-2 text-[11px] text-rose-300 border-b border-[var(--panel-border)] shrink-0">{err}</div>}
      <div
        ref={hostRef}
        className={`min-h-0 w-full overflow-hidden herdr-xterm-host ${fill ? "flex-1 h-full" : compact ? "h-[360px]" : "h-[520px]"}`}
        style={{ background: "#120d17" }}
      />
    </div>
  );
}
