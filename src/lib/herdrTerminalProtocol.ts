/** Shared WebSocket path + control-message shapes for the Code Space Herdr PTY. */

export const HERDR_TERMINAL_WS_PATH = "/api/herdr/terminal/ws";

/** Text JSON frames on the socket (binary frames are raw PTY bytes). */
export type HerdrTerminalControl =
  | { type: "resize"; cols: number; rows: number }
  | { type: "error"; message: string };
