import { JobQueue } from "./jobs";
import { ExecutionManager } from "./execution-manager";

export class SchedulerWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private jobs: JobQueue,
    private workerId: string,
    private pollIntervalMs = 5000
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.tick();
    } catch (err) {
      console.error("SchedulerWorker error:", err);
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => this.loop(), this.pollIntervalMs);
    }
  }

  private async tick(): Promise<void> {
    // In a full implementation, we'd iterate over due jobs in the queue
    // and try to claim them.
    // For now, this is a skeleton for the boot-owned claimant.
  }
}
