/**
 * First concrete PlatformAdapter for the personal localhost web host
 * ("web-local"), Phase 19a U1.
 *
 * This is the adapter the Phase 19b Electron shell replaces — the shared shell
 * code must not change when it does. The adapter uses only browser primitives:
 * no Node.js or process API is referenced anywhere in this module, so the same
 * file is runnable as a browser bundle.
 *
 * Adjustable browser seams are injected so the capability surface can be
 * exercised deterministically under node:test without a real window.
 */
import type {
  AppInfo,
  DirectorySelection,
  ExternalUrlResult,
  NotificationResult,
  PlatformAdapter,
  PlatformCapabilities,
  RuntimeHealth,
} from "./platform-capabilities";
import { PLATFORM_CONTRACT_VERSION } from "./platform-capabilities";

/** The small slice of the host the adapter needs, injectable for tests. */
export interface WebBrowserHost {
  /** Open `url` in a new tab; returns whether the host accepted the open. */
  open(url: string): boolean;
  /** Whether a notification API is present. */
  canNotify(): boolean;
  /** Resolve when the user makes a notification-permission decision. */
  requestNotificationPermission(): Promise<string>;
}

/** Default host backed by browser globals, guarded for undefined `window`. */
export function realBrowserHost(): WebBrowserHost {
  return {
    open(url) {
      if (typeof window === "undefined") return false;
      const created = window.open(url, "_blank", "noopener,noreferrer");
      return created !== null;
    },
    canNotify() {
      return typeof globalThis !== "undefined" && "Notification" in globalThis;
    },
    async requestNotificationPermission() {
      if (typeof globalThis === "undefined" || !("Notification" in globalThis)) {
        return "denied";
      }
      return Notification.requestPermission();
    },
  };
}

/** Build the web-local adapter, with injectable host + app info for tests. */
export function createWebLocalAdapter(
  host: WebBrowserHost = realBrowserHost(),
  appInfo: AppInfo = { origin: "http://127.0.0.1:3737", version: "1.0.0" },
): PlatformAdapter {
  const capabilities: PlatformCapabilities = {
    contractVersion: PLATFORM_CONTRACT_VERSION,
    kind: "web-local",
    appInfo,
    // A browser tab can open URLs and present notifications.
    canOpenExternalUrl: true,
    canNotify: host.canNotify(),
    // A web-local tab cannot launch an external system terminal.
    canOpenSystemTerminal: false,
    // Directory selection is a placeholder: no native picker yet.
    canSelectDirectory: false,
    // A browser cannot read its own process/runtime health reliably.
    canReportRuntimeHealth: false,
  };

  return {
    capabilities,
    openExternalUrl(url: string): ExternalUrlResult {
      if (!url) return { dispatched: false };
      return { dispatched: host.open(url) };
    },
    async notify(title: string, body?: string): Promise<NotificationResult> {
      if (!host.canNotify()) return { shown: false, reason: "notification API unavailable" };
      const permission = await host.requestNotificationPermission();
      if (permission !== "granted") {
        return { shown: false, reason: `notification permission: ${permission}` };
      }
      new Notification(title, body ? { body } : undefined);
      return { shown: true };
    },
    async selectDirectory(): Promise<DirectorySelection> {
      // Placeholder: browsers need File System Access API for a real picker.
      return { path: null, reason: "web-local placeholder: directory selection not implemented" };
    },
    async runtimeHealth(): Promise<RuntimeHealth> {
      return { available: false, reason: "browser runtime does not expose process health" };
    },
  };
}

/** Default web-local adapter for the personal localhost release. */
export const webLocalAdapter: PlatformAdapter = createWebLocalAdapter();