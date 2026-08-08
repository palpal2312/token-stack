import path from "node:path";
import os from "node:os";
import { readJsonIfPresent, writeJsonAtomic, type StorageFaults } from "./storage";

export interface Migration {
  id: string;
  checksum: string;
  appliedAt?: string;
}

export interface MigrationRegistry {
  version: 1;
  migrations: Migration[];
  locked?: boolean;
}

export class MigrationManager {
  readonly root: string;
  readonly path: string;
  private faults?: StorageFaults;

  constructor(options: { root?: string; faults?: StorageFaults } = {}) {
    this.root = path.resolve(
      options.root ??
        path.join(
          process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"),
          "llmops"
        )
    );
    this.path = path.join(this.root, "migrations.json");
    this.faults = options.faults;
  }

  async load(): Promise<MigrationRegistry> {
    const data = await readJsonIfPresent<unknown>(this.path);
    if (!data) return { version: 1, migrations: [] };
    const parsed = data as MigrationRegistry;
    if (parsed.version !== 1) throw new Error("Unsupported migration registry version");
    return parsed;
  }

  async lock(): Promise<void> {
    const registry = await this.load();
    if (registry.locked) throw new Error("Migrations are already locked by another process");
    registry.locked = true;
    await writeJsonAtomic(this.path, registry, this.faults);
  }

  async unlock(): Promise<void> {
    const registry = await this.load();
    registry.locked = false;
    await writeJsonAtomic(this.path, registry, this.faults);
  }

  async record(id: string, checksum: string): Promise<void> {
    const registry = await this.load();
    if (!registry.locked) throw new Error("Must lock before recording migration");
    if (registry.migrations.some(m => m.id === id)) {
      throw new Error(`Migration ${id} already applied`);
    }
    registry.migrations.push({
      id,
      checksum,
      appliedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(this.path, registry, this.faults);
  }

  async isApplied(id: string): Promise<boolean> {
    const registry = await this.load();
    return registry.migrations.some(m => m.id === id);
  }
}
