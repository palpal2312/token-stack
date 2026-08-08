import { isIP } from "node:net";

export interface NetworkDestinationPolicy {
  allowedProtocols: Array<"http:" | "https:">;
  allowedHosts?: string[];
  allowLoopback: boolean;
  allowPrivateAddresses: boolean;
  allowOriginChangeWithCredentials: boolean;
}

export interface NetworkDestinationInput {
  url: string;
  resolvedAddresses?: string[];
  previousUrl?: string;
  forwardsCredentials?: boolean;
}

export interface NetworkPolicyDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "invalid-url"
    | "url-credentials"
    | "protocol"
    | "host"
    | "loopback"
    | "private-address"
    | "unresolved-host"
    | "credential-origin-unpinned"
    | "credential-origin-change";
  /**
   * The exact resolution approved by policy. A transport must connect to one
   * of these addresses while preserving `origin` for Host/SNI, rather than
   * resolving the hostname again after validation.
   */
  pin?: {
    origin: string;
    hostname: string;
    addresses: string[];
  };
}

export const DEFAULT_NETWORK_DESTINATION_POLICY: NetworkDestinationPolicy = {
  allowedProtocols: ["https:"],
  allowLoopback: false,
  allowPrivateAddresses: false,
  allowOriginChangeWithCredentials: false,
};

export function evaluateNetworkDestination(
  input: NetworkDestinationInput,
  policy: NetworkDestinationPolicy = DEFAULT_NETWORK_DESTINATION_POLICY,
): NetworkPolicyDecision {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return denied("invalid-url");
  }
  if (url.username || url.password) return denied("url-credentials");
  if (!policy.allowedProtocols.includes(url.protocol as "http:" | "https:")) return denied("protocol");

  const hostname = normalizeHostname(url.hostname);
  if (policy.allowedHosts?.length
    && !policy.allowedHosts.some((allowed) => hostMatches(hostname, normalizeHostname(allowed)))) {
    return denied("host");
  }

  if (input.forwardsCredentials && input.previousUrl) {
    let previous: URL;
    try {
      previous = new URL(input.previousUrl);
    } catch {
      return denied("invalid-url");
    }
    if (previous.origin !== url.origin && !policy.allowOriginChangeWithCredentials) {
      return denied("credential-origin-change");
    }
  } else if (input.forwardsCredentials && !policy.allowedHosts?.length) {
    return denied("credential-origin-unpinned");
  }

  const addresses = isIP(hostname) ? [hostname] : input.resolvedAddresses;
  if (!addresses?.length) return denied("unresolved-host");
  for (const address of addresses) {
    const scope = classifyAddress(address);
    if (scope === "invalid") return denied("unresolved-host");
    if (scope === "loopback" && !policy.allowLoopback) return denied("loopback");
    if (scope === "private" && !policy.allowPrivateAddresses) return denied("private-address");
  }
  return {
    allowed: true,
    reason: "allowed",
    pin: {
      origin: url.origin,
      hostname,
      addresses: [...new Set(addresses.map((address) => address.trim().toLowerCase().replace(/^\[|\]$/g, "")))],
    },
  };
}

export function classifyAddress(address: string): "public" | "private" | "loopback" | "invalid" {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) {
    const [a, b] = normalized.split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
    if (a === 0 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
      || a >= 224 || (a === 192 && b === 0)) return "private";
    return "public";
  }
  if (version === 6) {
    if (normalized === "::1") return "loopback";
    if (normalized === "::") return "private";
    const embeddedDotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (embeddedDotted) return classifyAddress(embeddedDotted);
    if (normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || /^fe[c-f]/.test(normalized)
      || normalized.startsWith("ff")) return "private";
    const mappedHex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return classifyAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    const compatibleHex = normalized.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (compatibleHex) {
      const high = Number.parseInt(compatibleHex[1], 16);
      const low = Number.parseInt(compatibleHex[2], 16);
      return classifyAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return "public";
  }
  return "invalid";
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

function denied(reason: Exclude<NetworkPolicyDecision["reason"], "allowed">): NetworkPolicyDecision {
  return { allowed: false, reason };
}
