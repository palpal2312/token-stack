/**
 * Dashboard custom server: Next.js on 127.0.0.1:3737 plus a same-process
 * WebSocket upgrade for the Code Space Herdr terminal.
 *
 * Usage (via package.json):
 *   npm run dev    → development
 *   npm start      → production (run `npm run build` first)
 *
 * Only `/api/herdr/terminal/ws` is claimed; other upgrades (HMR) are passed to
 * Next when getUpgradeHandler is available.
 */

import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { parse } from "node:url";
import next from "next";
import { DASHBOARD_HOST, DASHBOARD_PORT } from "./src/lib/dashboard";
import {
  createHerdrTerminalWss,
  handleHerdrTerminalUpgrade,
  isHerdrTerminalWsPath,
} from "./src/lib/herdrTerminalWs";

const wantProd = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const dev = !wantProd;
const hostname = process.env.AGENTIC_OS_HOST || DASHBOARD_HOST;
const port = Number(process.env.PORT || process.env.AGENTIC_OS_PORT || DASHBOARD_PORT);

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = createHerdrTerminalWss();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsed = parse(req.url ?? "/", true);
    handle(req, res, parsed);
  });

  const nextUpgrade =
    typeof (app as { getUpgradeHandler?: () => UpgradeHandler }).getUpgradeHandler === "function"
      ? (app as { getUpgradeHandler: () => UpgradeHandler }).getUpgradeHandler()
      : null;

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/", true);
    if (isHerdrTerminalWsPath(pathname)) {
      handleHerdrTerminalUpgrade(wss, req, socket, head);
      return;
    }
    if (nextUpgrade) {
      nextUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });

  server.listen(port, hostname, () => {
    console.log(`> Agent OS dashboard http://${hostname}:${port} (${dev ? "dev" : "prod"} + herdr ws)`);
  });
}).catch((err) => {
  console.error("Failed to start dashboard server:", err);
  process.exit(1);
});
