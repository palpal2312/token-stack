import { SECRET_SENTINEL_UNTOUCHED } from "@/lib/config/config-schema";
import { desktopShellV2Enabled } from "@/shell/desktop-shell-flag";
import SchemaSettingsView from "@/features/settings/schema-settings-view";
import type { SettingsSnapshotInput } from "@/features/settings/schema-settings-view";

/**
 * Phase 19a U5 — schema-driven settings surface (read/preview + local only).
 *
 * Mounted ONLY under the `desktop_shell_v2` rollout flag (resolved server-side
 * at request time). When the flag is OFF the schema-driven settings UI is
 * unmounted — this page renders the same neutral placeholder the shell shows
 * before the settings engine ships, so the production default is unaffected.
 * There is NO write/update POST (deferred A-coordinated part); this surface
 * consumes the client-contract snapshot shape and prepares previews only.
 *
 * The snapshot is the CONSUMER-SHAPED contract from the Phase 19a inventory
 * (`ConfigSchema`, `CapabilityRegistry`, `EffectiveConfigExplanation`). The
 * authorizing Go endpoint (`go/internal/http/sen/config.go`, PROPOSED) will
 * serve this exact shape; until then the read path is this documented sample.
 */

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  const enabled = desktopShellV2Enabled();
  if (!enabled) {
    return (
      <div className="rounded-lg border border-neutral-800/70 px-4 py-8 text-center">
        <p className="text-sm text-neutral-500">Settings are unavailable while the desktop shell flag is off.</p>
      </div>
    );
  }
  return <SchemaSettingsView snapshot={SNAPSHOT} host={LOCAL_HOST} />;
}

/** The browser-local host admits every capability/permission (web-local adapter). */
const LOCAL_HOST = {
  capabilities: ["terminal", "notifications", "native-dialogs"],
  permissions: ["code-space.run", "approvals.read", "settings.write"],
};

/** Consumer-shaped read snapshot — mirrors the Go DTO contract this view consumes. */
const SNAPSHOT: SettingsSnapshotInput = {
  schema: {
    schemaId: "workspace.runtime",
    version: 3,
    scope: "workspace",
    sectionToken: "runtime",
    migrations: [
      { from: 2, to: 3, notes: "cache_policy added; sandbox_mode defaulted to 'nested'" },
      { from: 1, to: 2, notes: "execution mode split from retention" },
    ],
    fields: [
      {
        key: "execution_mode",
        label: "Execution mode policy",
        kind: "choice",
        defaultValue: "policy",
        choices: [
          { value: "policy", label: "Policy-constrained" },
          { value: "sandboxed", label: "Sandboxed" },
        ],
        impact: "future-attempts-only",
      },
      {
        key: "cache_policy",
        label: "Cache policy",
        kind: "choice",
        defaultValue: "conservative",
        choices: [
          { value: "conservative", label: "Conservative" },
          { value: "aggressive", label: "Aggressive" },
        ],
        impact: "requires-restart",
      },
      {
        key: "resource_ceiling",
        label: "Resource ceiling (GB)",
        kind: "number",
        defaultValue: 8,
        impact: "requires-restart",
      },
      {
        key: "sandbox_mode",
        label: "Sandbox compatibility",
        kind: "string",
        requiredCapability: "sandbox",
        defaultValue: "nested",
      },
      {
        key: "builder_token",
        label: "Builder provider token",
        kind: "secret",
        requiredPermission: "settings.write",
      },
      {
        key: "model_codex",
        label: "Codex model",
        kind: "computed",
        unsupportedReason: "Selected by the runtime profile; not editable here.",
      },
      {
        key: "experimental_streaming",
        label: "Experimental streaming",
        kind: "experimental",
        defaultValue: false,
        unsupportedReason: "Experimental on this build; gated by the host.",
        impact: "security-downgrade",
      },
    ],
  },
  capabilities: {
    version: 1,
    digest: "sha256:def0123456789abcdefedcba9876543210fedcba9876543210fedcba987654321",
    capabilities: [
      { id: "sandbox", present: true },
      { id: "terminal", present: true },
      { id: "notifications", present: false, reason: "Denied by workspace policy." },
    ],
  },
  current: {
    execution_mode: "policy",
    cache_policy: "aggressive",
    resource_ceiling: 12,
    sandbox_mode: "nested",
    builder_token: SECRET_SENTINEL_UNTOUCHED,
    model_codex: "opus-current",
    experimental_streaming: false,
    retention_days: 45, // unknown forward-compatible field a newer server wrote
  },
  sections: [
    { token: "runtime", moduleId: "code-space", label: "Runtime" },
  ],
  explanation: {
    schemaId: "workspace.runtime",
    version: 3,
    requested: {
      cache_policy: "aggressive",
      resource_ceiling: 12,
    },
    effective: {
      execution_mode: "policy",
      cache_policy: "aggressive",
      resource_ceiling: 12,
      sandbox_mode: "nested",
      builder_token: SECRET_SENTINEL_UNTOUCHED,
      model_codex: "opus-current",
      experimental_streaming: false,
      retention_days: 45,
    },
    sourceByField: {
      execution_mode: "workspace",
      cache_policy: "workspace",
      resource_ceiling: "workspace",
      sandbox_mode: "install",
      builder_token: "profile",
      model_codex: "profile",
      experimental_streaming: "view",
      retention_days: "workspace",
    },
    policyDecisions: [
      { field: "resource_ceiling", reason: "Upper-bounded to 16 GB by workspace policy." },
    ],
    warnings: ["Cache policy change applies after the next restart."],
    restartFields: ["cache_policy", "resource_ceiling"],
    requiresRestart: true,
    capabilityDigest: "sha256:def0123456789abcdefedcba9876543210fedcba9876543210fedcba987654321",
    priorVersion: {
      version: 2,
      effective: {
        execution_mode: "policy",
        cache_policy: "conservative",
        resource_ceiling: 16,
        sandbox_mode: "nested",
        builder_token: SECRET_SENTINEL_UNTOUCHED,
        model_codex: "opus-current",
        experimental_streaming: false,
      },
    },
  },
};