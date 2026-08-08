import crypto from "node:crypto";

export type AssetKind = "agent" | "prompt" | "automation" | "workflow";

export interface AssetRef {
  id: string;
  kind: string;
  uri: string;
  createdAt?: string;
  redactionClass: "public" | "local-sensitive" | "secret";
}

export interface AssetDraft {
  id: string;
  kind: AssetKind;
  content: unknown;
  updatedAt: string;
}

export interface AssetSnapshot {
  hash: string;
  kind: AssetKind;
  content: unknown;
  parentHash?: string;
  createdAt: string;
}

export interface AssetRelease {
  version: string;
  hash: string;
  releasedAt: string;
}

export function computeHash(content: unknown): string {
  const normalized = JSON.stringify(content, Object.keys(content || {}).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export class AssetRepository {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? path.join(
      process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"),
      "llmops",
      "assets"
    ));
  }

  private draftPath(id: string): string {
    return path.join(this.root, "drafts", `${id}.json`);
  }

  private snapshotPath(hash: string): string {
    return path.join(this.root, "snapshots", `${hash}.json`);
  }

  async saveDraft(draft: AssetDraft): Promise<void> {
    const file = this.draftPath(draft.id);
    await mkdir(path.dirname(file), { recursive: true });
    draft.updatedAt = new Date().toISOString();
    
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(draft, null, 2), "utf8");
    await rename(tmp, file);
  }

  async loadDraft(id: string): Promise<AssetDraft | null> {
    const file = this.draftPath(id);
    if (!existsSync(file)) return null;
    return JSON.parse(await readFile(file, "utf8"));
  }

  async createSnapshot(draftId: string): Promise<AssetSnapshot> {
    const draft = await this.loadDraft(draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);

    const hash = computeHash(draft.content);
    const snapshot: AssetSnapshot = {
      hash,
      kind: draft.kind,
      content: draft.content,
      createdAt: new Date().toISOString()
    };

    const file = this.snapshotPath(hash);
    if (!existsSync(file)) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(tmp, file);
    }

    return snapshot;
  }

  async loadSnapshot(hash: string): Promise<AssetSnapshot | null> {
    const file = this.snapshotPath(hash);
    if (!existsSync(file)) return null;
    return JSON.parse(await readFile(file, "utf8"));
  }

  async restoreSnapshotAsDraft(hash: string, newDraftId: string): Promise<AssetDraft> {
    const snapshot = await this.loadSnapshot(hash);
    if (!snapshot) throw new Error(`Snapshot ${hash} not found`);

    const draft: AssetDraft = {
      id: newDraftId,
      kind: snapshot.kind,
      content: snapshot.content,
      updatedAt: new Date().toISOString()
    };
    await this.saveDraft(draft);
    return draft;
  }
}
