/**
 * Platform-neutral capability contract (Phase 19a U1).
 *
 * The desktop shell queries `PlatformCapabilities` to learn what the current
 * host can do before offering it in the UI. The surface is deliberately
 * narrow: app identity/info, external URL opening, notification, an external
 * system-terminal hint, a directory-selection placeholder, and runtime health.
 *
 * This contract MUST stay platform-neutral:
 *  - no general shell or filesystem API,
 *  - no Electron-specific types or imports,
 *  - no Node/process API in any renderer-facing type.
 *
 * A web-local adapter (`./web-local-adapter`) is the first implementation; the
 * Phase 19b Electron shell ships a second adapter against this same contract.
 */
export const PLATFORM_CONTRACT_VERSION = 1 as const;

/** The two host kinds the shell can run on. */
export type PlatformKind = "web-local" | "desktop";

/** Resolved app identity for display. */
export interface AppInfo {
  /** Canonical application origin, e.g. "http://127.0.0.1:3737". */
  origin: string;
  /** Human-facing app version. */
  version: string;
}

/** Result of a directory-selection request. */
export interface DirectorySelection {
  /** Selected directory path when the host supports picking one, else null. */
  path: string | null;
  /** Why selection was unavailable, when it was. */
  reason?: string;
}

/** Host runtime-health report. */
export interface RuntimeHealth {
  /** True only when the host can report real runtime health. */
  available: boolean;
  /** Human-readable reason when not available. */
  reason?: string;
}

/** Result of an external-URL open request. */
export interface ExternalUrlResult {
  /** Whether the host accepted the request (not whether the OS opened it). */
  dispatched: boolean;
}

/** Result of a notification request. */
export interface NotificationResult {
  /** True only when a notification was actually presented. */
  shown: boolean;
  /** Human-readable reason when not shown. */
  reason?: string;
}

/**
 * What the current host can do. Pure data; the shell renders nothing heavier
 * than the features these flags admit.
 */
export interface PlatformCapabilities {
  /** Bump alongside the contract version; adapters must match exactly. */
  contractVersion: typeof PLATFORM_CONTRACT_VERSION;
  kind: PlatformKind;
  appInfo: AppInfo;
  canOpenExternalUrl: boolean;
  canNotify: boolean;
  /** Hint that an external system terminal is available for launch. */
  canOpenSystemTerminal: boolean;
  canSelectDirectory: boolean;
  canReportRuntimeHealth: boolean;
}

/**
 * The concrete surface an adapter satisfies. Kept small so the shared shell
 * code never reaches below it, and so the browser adapter and the future
 * Electron adapter are interchangeable under one contract.
 */
export interface PlatformAdapter {
  capabilities: PlatformCapabilities;
  openExternalUrl(url: string): ExternalUrlResult;
  notify(title: string, body?: string): Promise<NotificationResult>;
  selectDirectory(): Promise<DirectorySelection>;
  runtimeHealth(): Promise<RuntimeHealth>;
}