import {
  DIFY_MAX_TOTAL_STAGED_BYTES,
  DIFY_MAX_TOTAL_SPOOL_BYTES,
  DIFY_MAX_CONNECTION_REVISIONS,
  DIFY_MAX_OUTSTANDING_HANDOFFS,
  DIFY_MAX_OUTSTANDING_HANDOFF_BYTES,
  DIFY_STAGED_REF_TTL_MS,
  DIFY_HANDOFF_TTL_MS,
  DIFY_OUTPUT_SPOOL_RETENTION_MS,
} from "./limits";

/**
 * Reservation type for capacity tracking.
 */
export type ReservationType = "staging" | "spool" | "handoff" | "connection-revision";

/**
 * Capacity reservation record.
 */
export interface CapacityReservation {
  id: string;
  type: ReservationType;
  bytes: number;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Capacity manager for Dify aggregate limits.
 */
export class CapacityManager {
  private reservations = new Map<string, CapacityReservation>();

  /**
   * Recover reservations from actual disk state after crash.
   */
  async recover(actualReservations: CapacityReservation[]): Promise<void> {
    this.reservations.clear();
    for (const reservation of actualReservations) {
      this.assertReservation(reservation);
      if (this.reservations.has(reservation.id)) throw new Error(`duplicate capacity reservation ${reservation.id}`);
      if (this.wouldExceed(reservation.type, reservation.bytes)) throw this.capacityError(reservation.type, reservation.bytes);
      const countLimit = this.getCountLimitForType(reservation.type);
      if (countLimit !== null && this.getCountByType(reservation.type) + 1 > countLimit) {
        throw this.countError(reservation.type, countLimit);
      }
      this.reservations.set(reservation.id, reservation);
    }
    await this.evictExpired();
  }

  /**
   * Reserve capacity for a new operation.
   * @throws Error with code 'storage-capacity' if limit exceeded
   */
  reserve(reservation: CapacityReservation): void {
    this.evictExpiredSync();
    this.assertReservation(reservation);
    if (this.reservations.has(reservation.id)) {
      throw new Error(`capacity reservation ${reservation.id} already exists`);
    }

    const { type, bytes } = reservation;
    const current = this.getTotalByType(type);

    const limit = this.getLimitForType(type);
    if (current + bytes > limit) throw this.capacityError(type, bytes);
    const countLimit = this.getCountLimitForType(type);
    if (countLimit !== null && this.getCountByType(type) + 1 > countLimit) {
      throw this.countError(type, countLimit);
    }

    this.reservations.set(reservation.id, reservation);
  }

  /**
   * Release a reservation.
   */
  release(id: string): void {
    this.reservations.delete(id);
  }

  /**
   * Get current total bytes reserved by type.
   */
  getTotalByType(type: ReservationType): number {
    let total = 0;
    this.reservations.forEach((reservation) => {
      if (reservation.type === type) {
        total += reservation.bytes;
      }
    });
    return total;
  }

  getCountByType(type: ReservationType): number {
    let count = 0;
    this.reservations.forEach((reservation) => {
      if (reservation.type === type) count += 1;
    });
    return count;
  }

  /**
   * Get aggregate limit for a reservation type.
   */
  private getLimitForType(type: ReservationType): number {
    switch (type) {
      case "staging":
        return DIFY_MAX_TOTAL_STAGED_BYTES;
      case "spool":
        return DIFY_MAX_TOTAL_SPOOL_BYTES;
      case "handoff":
        return DIFY_MAX_OUTSTANDING_HANDOFF_BYTES;
      case "connection-revision":
        return Number.MAX_SAFE_INTEGER;
    }
  }

  private getCountLimitForType(type: ReservationType): number | null {
    switch (type) {
      case "handoff": return DIFY_MAX_OUTSTANDING_HANDOFFS;
      case "connection-revision": return DIFY_MAX_CONNECTION_REVISIONS;
      default: return null;
    }
  }

  /**
   * Evict expired reservations (synchronous for inline checks).
   */
  private evictExpiredSync(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    this.reservations.forEach((reservation, id) => {
      if (reservation.expiresAt && new Date(reservation.expiresAt).getTime() <= now) {
        toDelete.push(id);
      }
    });
    for (const id of toDelete) {
      this.reservations.delete(id);
    }
  }

  /**
   * Evict expired reservations (async for maintenance sweeps).
   */
  async evictExpired(): Promise<number> {
    const now = Date.now();
    let count = 0;
    const toDelete: string[] = [];
    this.reservations.forEach((reservation, id) => {
      if (reservation.expiresAt && new Date(reservation.expiresAt).getTime() <= now) {
        toDelete.push(id);
      }
    });
    for (const id of toDelete) {
      this.reservations.delete(id);
      count++;
    }
    return count;
  }

  /**
   * Get all current reservations.
   */
  getAllReservations(): CapacityReservation[] {
    const result: CapacityReservation[] = [];
    this.reservations.forEach((reservation) => {
      result.push(reservation);
    });
    return result;
  }

  /**
   * Check if a specific limit would be exceeded.
   */
  wouldExceed(type: ReservationType, additionalBytes: number): boolean {
    if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) return true;
    this.evictExpiredSync();
    const current = this.getTotalByType(type);
    const limit = this.getLimitForType(type);
    return current + additionalBytes > limit;
  }

  private assertReservation(reservation: CapacityReservation): void {
    if (!reservation || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(reservation.id)) {
      throw new Error("capacity reservation id is invalid");
    }
    if (!Number.isSafeInteger(reservation.bytes) || reservation.bytes < 0) {
      throw new Error("capacity reservation bytes must be a non-negative safe integer");
    }
    if (reservation.expiresAt && Number.isNaN(new Date(reservation.expiresAt).valueOf())) {
      throw new Error("capacity reservation expiration is invalid");
    }
  }

  private capacityError(type: ReservationType, bytes: number): Error {
    const error = new Error(`${type} capacity exceeded: ${this.getTotalByType(type) + bytes} > ${this.getLimitForType(type)}`);
    (error as Error & { code?: number; storageCode?: string }).code = 507;
    (error as Error & { storageCode?: string }).storageCode = "storage-capacity";
    return error;
  }

  private countError(type: ReservationType, limit: number): Error {
    const error = new Error(`${type} count capacity exceeded: ${this.getCountByType(type) + 1} > ${limit}`);
    (error as Error & { code?: number; storageCode?: string }).code = 507;
    (error as Error & { storageCode?: string }).storageCode = "storage-capacity";
    return error;
  }
}

/**
 * Global capacity manager instance.
 */
export const globalCapacity = new CapacityManager();

/**
 * Calculate expiration timestamp for staging references.
 */
export function getStagingExpiration(): string {
  return new Date(Date.now() + DIFY_STAGED_REF_TTL_MS).toISOString();
}

/**
 * Calculate expiration timestamp for handoffs.
 */
export function getHandoffExpiration(): string {
  return new Date(Date.now() + DIFY_HANDOFF_TTL_MS).toISOString();
}

/**
 * Calculate expiration timestamp for spool retention.
 */
export function getSpoolExpiration(): string {
  return new Date(Date.now() + DIFY_OUTPUT_SPOOL_RETENTION_MS).toISOString();
}
