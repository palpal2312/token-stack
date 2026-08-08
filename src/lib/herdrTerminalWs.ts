// WebSocket bridge for the embedded Herdr PTY. Lives in the same Node process
// as the Next custom server so it shares herdrTerminal's global session.
//
// Protocol:
//   binary  → raw PTY stdin/stdout (UTF-8)
//   text    → JSON control: {type:"resize",cols,rows} | {type:"error",message}

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { API_TOKEN_HEADER, verifyApiToken } from "./apiToken";
import { readSessionCookie } from "./sessionCookie";
import {
  writeInput, resize, subscribe, terminalState, clampCols, clampRows,
} from "./herdrTerminal";
import { HERDR_TERMINAL_WS_PATH, type HerdrTerminalControl } from "./herdrTerminalProtocol";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return ALLOWED_HOSTS.has(u.hostname) || ALLOWED_HOSTS.has(`[${u.hostname}]`);
  } catch { return false; }
}

export function isHerdrTerminalWsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Strip query string if present
  const path = pathname.split("?")[0] ?? pathname;
  return path === HERDR_TERMINAL_WS_PATH;
}

/**
 * Auth for the WS upgrade (GET). Same posture as checkLocalRequest for
 * streams: loopback Origin/Referer when present, API token via the
 * x-agentic-os-token header (non-browser callers) or the HttpOnly
 * agentic_os_session cookie (the browser — a same-origin WebSocket upgrade
 * carries cookies automatically). ?token= is NOT accepted: a token in a URL
 * leaks into logs and history.
 */
export function authorizeHerdrTerminalUpgrade(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (origin && !hostAllowed(origin)) {
    return `Refused: this endpoint only answers the local dashboard, not ${origin}.`;
  }
  const referer = req.headers.referer;
  if (!origin && referer && !hostAllowed(referer)) {
    return "Refused: this endpoint only answers the local dashboard.";
  }

  const presented =
    (typeof req.headers[API_TOKEN_HEADER] === "string" ? req.headers[API_TOKEN_HEADER] : null)
    ?? readSessionCookie(req.headers.cookie);
  if (!verifyApiToken(presented)) {
    return "This endpoint requires the dashboard API token (agentic_os_session cookie or x-agentic-os-token header).";
  }
  return null;
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function sendControl(ws: WebSocket, msg: HerdrTerminalControl): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function attachSession(ws: WebSocket): void {
  const state = terminalState();
  if (!state.running) {
    sendControl(ws, {
      type: "error",
      message: state.exited
        ? "The terminal process has exited. Press Restart."
        : "The terminal is not running. POST {op:\"start\"} first.",
    });
    ws.close(4409, "not running");
    return;
  }

  const enc = new TextEncoder();
  const unsub = subscribe((chunk) => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(enc.encode(chunk)); }
    catch { /* socket racing close */ }
  });

  ws.on("message", (data: RawData, isBinary: boolean) => {
    const text = rawDataToUtf8(data);
    if (!isBinary && text.startsWith("{")) {
      try {
        const msg = JSON.parse(text) as HerdrTerminalControl;
        if (msg?.type === "resize") {
          resize(clampCols(msg.cols), clampRows(msg.rows));
          return;
        }
      } catch { /* fall through — treat as stdin */ }
    }
    writeInput(text);
  });

  ws.on("close", () => { unsub(); });
  ws.on("error", () => { unsub(); });
}

/**
 * Create a noServer WebSocketServer and wire connection handling.
 * The HTTP server must call handleUpgrade only for HERDR_TERMINAL_WS_PATH.
 */
export function createHerdrTerminalWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => { attachSession(ws); });
  return wss;
}

export function handleHerdrTerminalUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const denied = authorizeHerdrTerminalUpgrade(req);
  if (denied) {
    const status = denied.startsWith("Refused:") ? "403 Forbidden" : "401 Unauthorized";
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}
