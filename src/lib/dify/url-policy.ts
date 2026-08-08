import { isIPv4, isIPv6 } from "node:net";
// Use dynamic import or require fallback for environments where global URL is missing/clobbered
const URL = typeof globalThis.URL !== "undefined" ? globalThis.URL : require("node:url").URL;

/**
 * Dify URL policy for loopback-only MVP.
 * Validates and normalizes Service API base URLs.
 */

export interface ValidatedDifyUrl {
  serviceApiBase: string;
  origin: string;
}

export interface UrlValidationResult {
  ok: boolean;
  error?: string;
  validated?: ValidatedDifyUrl;
}

const LOOPBACK_IPV4 = "127.0.0.1";
const LOOPBACK_IPV6 = "::1";
const LOCALHOST = "localhost";

/**
 * Validate and normalize a Dify Service API base URL.
 * MVP: loopback addresses only (127.0.0.1, ::1, localhost).
 */
export function validateDifyUrl(input: string): UrlValidationResult {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "URL is required" };
  }

  const trimmed = input.trim();

  // Pre-parse checks for things URL constructor normalizes away
  if (trimmed.includes("..") || /\.\/(:|$)/.test(trimmed) || /\.$/.test(trimmed.split('/')[2] || '')) {
    return { ok: false, error: "Hostname cannot have trailing or consecutive dots" };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  // Scheme validation
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https schemes are supported" };
  }

  // Reject userinfo
  if (url.username || url.password) {
    return { ok: false, error: "URLs with credentials are not allowed" };
  }

  // Reject query and fragment
  if (url.search || url.hash) {
    return { ok: false, error: "Query parameters and fragments are not allowed" };
  }

  // Hostname validation
  const hostname = url.hostname.toLowerCase();

  // Validate loopback address
  if (hostname === LOCALHOST) {
    // localhost is acceptable
  } else if (isIPv4(hostname)) {
    if (hostname !== LOOPBACK_IPV4) {
      return { ok: false, error: "Only loopback address 127.0.0.1 is allowed in MVP" };
    }
  } else if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1);
    if (!isIPv6(ipv6) || ipv6 !== LOOPBACK_IPV6) {
      return { ok: false, error: "Only loopback address ::1 is allowed in MVP" };
    }
  } else {
    return { ok: false, error: "Only localhost, 127.0.0.1, and ::1 are allowed in MVP" };
  }

  // Path normalization
  const path = url.pathname;
  let normalizedPath = "";

  if (path === "/" || path === "") {
    normalizedPath = "/v1";
  } else if (path === "/v1" || path === "/v1/") {
    normalizedPath = "/v1";
  } else {
    return { ok: false, error: "Path must be empty, /, or /v1 (no additional path prefixes allowed)" };
  }

  // Check for percent-encoded characters in path
  if (path !== decodeURIComponent(path)) {
    return { ok: false, error: "Percent-encoded paths are not allowed" };
  }

  const origin = url.origin;
  const serviceApiBase = `${origin}${normalizedPath}`;

  return {
    ok: true,
    validated: {
      serviceApiBase,
      origin,
    },
  };
}

/**
 * Resolve hostname and verify all A/AAAA records point to loopback.
 */
export async function verifyLoopbackResolution(hostname: string): Promise<{ ok: boolean; error?: string }> {
  // Direct IP validation
  if (isIPv4(hostname)) {
    if (hostname === LOOPBACK_IPV4) {
      return { ok: true };
    }
    return { ok: false, error: "IPv4 address is not loopback" };
  }

  if (isIPv6(hostname)) {
    if (hostname === LOOPBACK_IPV6) {
      return { ok: true };
    }
    return { ok: false, error: "IPv6 address is not loopback" };
  }

  // Hostname resolution
  if (hostname.toLowerCase() === LOCALHOST) {
    try {
      const { promises: dns } = await import("node:dns");
      const addresses = await Promise.all([
        dns.resolve4(hostname).catch(() => [] as string[]),
        dns.resolve6(hostname).catch(() => [] as string[]),
      ]);

      const ipv4Addresses = addresses[0];
      const ipv6Addresses = addresses[1];

      if (ipv4Addresses.length === 0 && ipv6Addresses.length === 0) {
        return { ok: false, error: "Hostname does not resolve to any address" };
      }

      // All IPv4 addresses must be 127.0.0.1
      for (const addr of ipv4Addresses) {
        if (addr !== LOOPBACK_IPV4) {
          return { ok: false, error: `Resolved IPv4 address ${addr} is not loopback` };
        }
      }

      // All IPv6 addresses must be ::1
      for (const addr of ipv6Addresses) {
        if (addr !== LOOPBACK_IPV6) {
          return { ok: false, error: `Resolved IPv6 address ${addr} is not loopback` };
        }
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  return { ok: false, error: "Hostname is not recognized as loopback" };
}

/**
 * Check if a URL points to a loopback address without DNS resolution.
 * Fast check for validation; full verification needs verifyLoopbackResolution.
 */
export function isLoopbackUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (hostname === LOCALHOST) return true;
    if (isIPv4(hostname) && hostname === LOOPBACK_IPV4) return true;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      const ipv6 = hostname.slice(1, -1);
      if (isIPv6(ipv6) && ipv6 === LOOPBACK_IPV6) return true;
    }

    return false;
  } catch {
    return false;
  }
}
