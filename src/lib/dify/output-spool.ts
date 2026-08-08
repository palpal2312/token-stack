import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import {
  DIFY_MAX_OUTPUT_KEYS,
  DIFY_MAX_OUTPUT_VALUE_BYTES,
  DIFY_MAX_OUTPUT_AGGREGATE_BYTES,
  DIFY_MAX_TOTAL_SPOOL_BYTES,
  DIFY_OUTPUT_SPOOL_RETENTION_MS,
} from "./limits";
import type { DifyArtifactManifest } from "./contracts";
import type { RedactionClass } from "../llmops/contracts";

export interface SpoolReservation {
  runId: string;
  reservationId: string;
  keys: Set<string>;
  reservedBytes: number;
  writtenBytes: number;
}

export interface OutputSpoolManifest {
  runId: string;
  artifacts: DifyArtifactManifest[];
  spooledAt: string;
}

export class DifyOutputSpooler {
  private baseDir: string;
  private reservations: Map<string, SpoolReservation> = new Map();

  constructor(baseDir?: string) {
    // Default to ~/.agentic-os/runtime/runs
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    this.baseDir = baseDir || path.join(homeDir, ".agentic-os", "runtime", "runs");
  }

  /**
   * Initializes the spool directory structure.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Generates a spool directory path for a specific run.
   */
  private getRunSpoolDir(runId: string): string {
    return path.join(this.baseDir, runId, "dify-output");
  }

  /**
   * Reserves capacity for spooling outputs for a run.
   */
  async reserve(runId: string, keys: string[], estimatedBytes: number): Promise<string> {
    if (keys.length > DIFY_MAX_OUTPUT_KEYS) {
      throw new Error(`Exceeded maximum output keys per run: ${DIFY_MAX_OUTPUT_KEYS}`);
    }

    if (estimatedBytes > DIFY_MAX_OUTPUT_AGGREGATE_BYTES) {
      throw new Error(`Exceeded maximum aggregate output bytes per run: ${DIFY_MAX_OUTPUT_AGGREGATE_BYTES}`);
    }

    const currentTotalBytes = await this.calculateTotalSpoolBytes();
    if (currentTotalBytes + estimatedBytes > DIFY_MAX_TOTAL_SPOOL_BYTES) {
      await this.evictOldest();
      // Recalculate after eviction
      const newTotalBytes = await this.calculateTotalSpoolBytes();
      if (newTotalBytes + estimatedBytes > DIFY_MAX_TOTAL_SPOOL_BYTES) {
        throw new Error(`Insufficient total spool capacity. Max: ${DIFY_MAX_TOTAL_SPOOL_BYTES} bytes`);
      }
    }

    const reservationId = crypto.randomUUID();
    this.reservations.set(reservationId, {
      runId,
      reservationId,
      keys: new Set(keys),
      reservedBytes: estimatedBytes,
      writtenBytes: 0,
    });

    return reservationId;
  }

  /**
   * Writes an output value to the spool.
   */
  async write(
    reservationId: string,
    key: string,
    data: Buffer | string,
    type: string,
    redactionClass: RedactionClass = "public"
  ): Promise<DifyArtifactManifest> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Invalid or expired reservation: ${reservationId}`);
    }

    if (!reservation.keys.has(key)) {
      throw new Error(`Key ${key} was not reserved`);
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const sizeBytes = buffer.length;

    let omitted = false;
    let finalBuffer = buffer;

    if (sizeBytes > DIFY_MAX_OUTPUT_VALUE_BYTES) {
      // Truncate and mark as omitted instead of failing completely, to match "omitted: boolean" manifest
      // For now we will just omit it completely if it's too large to save space.
      // Or we can save a truncated version. Let's just omit it.
      omitted = true;
      finalBuffer = Buffer.from("");
    } else if (reservation.writtenBytes + sizeBytes > DIFY_MAX_OUTPUT_AGGREGATE_BYTES) {
        omitted = true;
        finalBuffer = Buffer.from("");
    }

    const spoolDir = this.getRunSpoolDir(reservation.runId);
    await fs.mkdir(spoolDir, { recursive: true });
    
    // Hash key for safe filename
    const safeKey = crypto.createHash("sha256").update(key).digest("hex");
    const filePath = path.join(spoolDir, `${safeKey}.dat`);

    if (!omitted) {
      await fs.writeFile(filePath, finalBuffer);
      reservation.writtenBytes += sizeBytes;
    }

    return {
      key,
      type,
      sizeBytes: omitted ? sizeBytes : finalBuffer.length,
      omitted,
      redactionClass,
    };
  }
  
  /**
   * Finalizes a reservation and generates the manifest.
   */
  async finalize(reservationId: string, artifacts: DifyArtifactManifest[]): Promise<OutputSpoolManifest> {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) {
          throw new Error(`Invalid or expired reservation: ${reservationId}`);
      }
      
      const manifest: OutputSpoolManifest = {
          runId: reservation.runId,
          artifacts,
          spooledAt: new Date().toISOString()
      };
      
      const spoolDir = this.getRunSpoolDir(reservation.runId);
      await fs.mkdir(spoolDir, { recursive: true });
      await fs.writeFile(
          path.join(spoolDir, "manifest.json"),
          JSON.stringify(manifest, null, 2)
      );
      
      this.reservations.delete(reservationId);
      return manifest;
  }

  /**
   * Calculates total bytes used by all runs in the spool directory.
   */
  protected async calculateTotalSpoolBytes(): Promise<number> {
    try {
      let totalBytes = 0;
      const runs = await fs.readdir(this.baseDir);
      for (const run of runs) {
        const spoolDir = path.join(this.baseDir, run, "dify-output");
        try {
          const stats = await fs.stat(spoolDir);
          if (stats.isDirectory()) {
             totalBytes += await this.getDirSize(spoolDir);
          }
        } catch (e) {
          // Ignore if dify-output doesn't exist for this run
        }
      }
      return totalBytes;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw e;
    }
  }
  
  protected async getDirSize(dirPath: string): Promise<number> {
      let size = 0;
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      for (const file of files) {
          const fullPath = path.join(dirPath, file.name);
          if (file.isDirectory()) {
              size += await this.getDirSize(fullPath);
          } else {
              const stat = await fs.stat(fullPath);
              size += stat.size;
          }
      }
      return size;
  }

  /**
   * Evicts runs older than retention limit.
   */
  private async evictOldest(): Promise<void> {
    try {
      const runs = await fs.readdir(this.baseDir);
      const now = Date.now();
      
      const runStats: { run: string, mtime: number }[] = [];
      
      for (const run of runs) {
        const spoolDir = path.join(this.baseDir, run, "dify-output");
        try {
          const manifestPath = path.join(spoolDir, "manifest.json");
          const stat = await fs.stat(manifestPath);
          runStats.push({ run, mtime: stat.mtimeMs });
        } catch (e) {
          // Ignore runs without a manifest
        }
      }
      
      // Sort oldest first
      runStats.sort((a, b) => a.mtime - b.mtime);
      
      for (const { run, mtime } of runStats) {
        // Evict if older than retention
        if (now - mtime > DIFY_OUTPUT_SPOOL_RETENTION_MS) {
           const spoolDir = path.join(this.baseDir, run, "dify-output");
           await fs.rm(spoolDir, { recursive: true, force: true });
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }
  }
}
