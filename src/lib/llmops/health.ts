import { RunLedger } from "./ledger";
import { MigrationManager } from "./migrations";

export interface ComponentHealth {
  status: "ok" | "degraded" | "failed";
  message?: string;
}

export interface SystemHealth {
  status: "ok" | "degraded" | "failed";
  storage: ComponentHealth;
  migrations: ComponentHealth;
  scheduler: ComponentHealth;
  exporter: ComponentHealth;
  index: ComponentHealth;
}

export class HealthReporter {
  constructor(
    private readonly ledger: RunLedger,
    private readonly migrationManager: MigrationManager
  ) {}

  async check(): Promise<SystemHealth> {
    const health: SystemHealth = {
      status: "ok",
      storage: { status: "ok" },
      migrations: { status: "ok" },
      scheduler: { status: "ok" },
      exporter: { status: "ok" },
      index: { status: "ok" }
    };

    try {
      await this.ledger.snapshot();
    } catch (e) {
      health.storage = { status: "failed", message: String(e) };
      health.status = "failed";
    }

    try {
      const reg = await this.migrationManager.load();
      if (reg.locked) {
        health.migrations = { status: "degraded", message: "Migrations locked" };
        if (health.status !== "failed") health.status = "degraded";
      }
    } catch (e) {
      health.migrations = { status: "failed", message: String(e) };
      health.status = "failed";
    }

    return health;
  }
}
