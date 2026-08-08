import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fmHome, readHome } from "./sen";

export type KnowledgeKind = "config" | "data";

export interface KnowledgeFile {
  id: string;
  name: string;
  kind: KnowledgeKind;
  bytes: number;
  mtime: number;
  relPath: string;
}

const CONFIG_EXT = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);
const DATA_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv", ".tsv", ".docx"]);
const MAX_BYTES = 25 * 1024 * 1024;

export function kindForFilename(name: string): KnowledgeKind | null {
  const ext = path.extname(name).toLowerCase();
  if (CONFIG_EXT.has(ext)) return "config";
  if (DATA_EXT.has(ext)) return "data";
  return null;
}

export async function knowledgeDirs(): Promise<{
  root: string;
  configDir: string;
  dataDir: string;
  home: string;
  homeFound: boolean;
}> {
  const home = await readHome();
  const root = home.found
    ? path.join(home.home, "data", "knowledge")
    : path.join(process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"), "sen-knowledge");
  const configDir = path.join(root, "config");
  const dataDir = path.join(root, "data");
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  return { root, configDir, dataDir, home: home.home || fmHome(), homeFound: home.found };
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, "_").trim();
  return base.slice(0, 180) || `file-${Date.now()}`;
}

async function listDir(dir: string, kind: KnowledgeKind, prefix: string): Promise<KnowledgeFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: KnowledgeFile[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) continue;
      out.push({
        id: `${kind}/${name}`,
        name,
        kind,
        bytes: st.size,
        mtime: st.mtimeMs,
        relPath: path.join(prefix, name),
      });
    } catch { /* skip */ }
  }
  return out;
}

export async function listKnowledgeFiles(): Promise<{
  root: string;
  home: string;
  homeFound: boolean;
  files: KnowledgeFile[];
}> {
  const dirs = await knowledgeDirs();
  const files = [
    ...(await listDir(dirs.configDir, "config", "config")),
    ...(await listDir(dirs.dataDir, "data", "data")),
  ].sort((a, b) => b.mtime - a.mtime);
  return { root: dirs.root, home: dirs.home, homeFound: dirs.homeFound, files };
}

export async function saveKnowledgeUpload(file: File, kindHint?: string): Promise<KnowledgeFile> {
  if (file.size <= 0) throw new Error("Empty file.");
  if (file.size > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.`);
  const inferred = kindForFilename(file.name);
  const kind = (kindHint === "config" || kindHint === "data" ? kindHint : inferred) as KnowledgeKind | null;
  if (!kind || !inferred) {
    throw new Error("Unsupported type. Config: .md .txt .json .yaml .yml · Data: .pdf .xlsx .xls .csv .tsv .docx");
  }
  if (kind === "config" && !CONFIG_EXT.has(path.extname(file.name).toLowerCase())) {
    throw new Error("Config uploads must be markdown/text/JSON/YAML.");
  }
  if (kind === "data" && !DATA_EXT.has(path.extname(file.name).toLowerCase())) {
    throw new Error("Data uploads must be PDF / Excel / CSV / DOCX.");
  }

  const dirs = await knowledgeDirs();
  const dir = kind === "config" ? dirs.configDir : dirs.dataDir;
  let name = safeName(file.name);
  let dest = path.join(dir, name);
  // Avoid clobber: append short suffix if exists.
  try {
    await fs.access(dest);
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    name = `${stem}-${Date.now().toString(36).slice(-4)}${ext}`;
    dest = path.join(dir, name);
  } catch { /* free */ }

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(dest, buf);
  const st = await fs.stat(dest);
  return {
    id: `${kind}/${name}`,
    name,
    kind,
    bytes: st.size,
    mtime: st.mtimeMs,
    relPath: path.join(kind, name),
  };
}

export async function deleteKnowledgeFile(id: string): Promise<void> {
  const m = id.match(/^(config|data)\/([^/\\]+)$/);
  if (!m) throw new Error("Invalid file id.");
  const dirs = await knowledgeDirs();
  const dir = m[1] === "config" ? dirs.configDir : dirs.dataDir;
  const abs = path.join(dir, m[2]);
  if (!abs.startsWith(dir + path.sep) && abs !== dir) throw new Error("Path escape blocked.");
  await fs.unlink(abs);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
