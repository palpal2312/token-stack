/**
 * Copy ghostty-web's WASM into public/ so the browser can fetch /ghostty-vt.wasm.
 * Run from source/ (npm postinstall / manual).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "public");
const dest = path.join(destDir, "ghostty-vt.wasm");
const candidates = [
  path.join(root, "node_modules", "ghostty-web", "ghostty-vt.wasm"),
  path.join(root, "node_modules", "ghostty-web", "dist", "ghostty-vt.wasm"),
];

const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.warn("[copy-ghostty-wasm] ghostty-vt.wasm not found under node_modules/ghostty-web — skip");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-ghostty-wasm] ${path.relative(root, src)} → public/ghostty-vt.wasm`);
