/**
 * Desktop module registry (Phase 19a U1).
 *
 * A versioned, permission- and capability-aware registry of the routes that
 * belong in the desktop shell. It mirrors the authoritative navigation set from
 * `src/components/Sidebar.tsx` (Workspace section + the Kanban app) as pure
 * data, so the shell can filter by what the user's host/permissions admit.
 *
 * This module is pure and side-effect free: no React, no Next.js imports, no
 * DOM — the selectors are unit-testable under node:test. `load`/`prefetch`
 * return no-op promises until the integration stage wires real lazy loads, and
 * the router/layout does not import this registry until the flag is on.
 */

/** Bump when the definition shape changes; every definition must match. */
export const DESKTOP_MODULE_SCHEMA_VERSION = 1 as const;

/** Capabilities a module may demand of the host. */
export type CapabilityToken = "terminal" | "notifications" | "native-dialogs";

/** Permissions a module may require beyond host capabilities. */
export type PermissionToken = "code-space.run" | "approvals.read" | "settings.write";

/** Icon tokens mapped to lucide icons by the shell renderer. */
export type IconToken =
  | "sen"
  | "layout-dashboard"
  | "columns-3"
  | "square-terminal"
  | "brain"
  | "sliders-horizontal"
  | "waypoints"
  | "boxes"
  | "target"
  | "calendar-clock"
  | "repeat";

/** A command id registered by a module (resolved by the command registry). */
export type CommandToken = string;

/** A settings section id a module owns (resolved by the settings UI). */
export type SettingsSectionToken = string;

export interface DesktopModuleDefinition {
  schemaVersion: typeof DESKTOP_MODULE_SCHEMA_VERSION;
  /** Stable, permission-independent module identity. */
  id: string;
  /** Route the module renders at, e.g. "/sen". */
  route: string;
  /** i18n token for the title, e.g. "nav.sen". */
  titleKey: string;
  /** Icon token resolved to a lucide icon by the shell. */
  iconToken: IconToken;
  /** Sort order in navigation; lower first. */
  order: number;
  /** Host capabilities required for the module to be visible (subset of host's). */
  requiredCapabilities: readonly CapabilityToken[];
  /** Permissions required for the module to be visible. */
  requiredPermissions: readonly PermissionToken[];
  /** Lazy loader for the module's view; no-op until the integration stage. */
  load: () => Promise<unknown>;
  /** Intent prefetch hint; no-op by default. */
  prefetch: () => void;
  /** Command ids this module registers with the command registry. */
  commands: readonly CommandToken[];
  /** Settings section ids this module contributes. */
  settingsSections: readonly SettingsSectionToken[];
}

const loader = (): Promise<void> => Promise.resolve();

/** The authoritative shell module set, ordered by `order`. */
export const DESKTOP_MODULES: readonly DesktopModuleDefinition[] = [
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "sen",
    route: "/sen",
    titleKey: "nav.sen",
    iconToken: "sen",
    order: 10,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: ["sen.new-session"],
    settingsSections: ["sen"],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "agent-kanban",
    route: "/agent-kanban",
    titleKey: "nav.agentKanban",
    iconToken: "layout-dashboard",
    order: 20,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: [],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "kanban",
    route: "/kanban",
    titleKey: "nav.kanban",
    iconToken: "columns-3",
    order: 30,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: [],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "code-space",
    route: "/code-space",
    titleKey: "nav.codeSpace",
    iconToken: "square-terminal",
    order: 40,
    requiredCapabilities: ["terminal"],
    requiredPermissions: ["code-space.run"],
    load: loader,
    prefetch: () => {},
    commands: ["runtime.terminal"],
    settingsSections: ["runtime"],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "memory",
    route: "/memory",
    titleKey: "nav.memory",
    iconToken: "brain",
    order: 50,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: [],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "builders",
    route: "/builders",
    titleKey: "nav.builders",
    iconToken: "sliders-horizontal",
    order: 60,
    requiredCapabilities: [],
    requiredPermissions: ["settings.write"],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: ["builders"],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "routers",
    route: "/routers",
    titleKey: "nav.routers",
    iconToken: "waypoints",
    order: 70,
    requiredCapabilities: [],
    requiredPermissions: ["settings.write"],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: ["routers"],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "integrations",
    route: "/integrations",
    titleKey: "nav.integrations",
    iconToken: "boxes",
    order: 80,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: ["integrations"],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "goals",
    route: "/goals",
    titleKey: "nav.goals",
    iconToken: "target",
    order: 90,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: [],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "automations",
    route: "/automations",
    titleKey: "nav.automations",
    iconToken: "calendar-clock",
    order: 100,
    requiredCapabilities: [],
    requiredPermissions: ["approvals.read"],
    load: loader,
    prefetch: () => {},
    commands: ["automations.approve"],
    settingsSections: [],
  },
  {
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "loop",
    route: "/loop",
    titleKey: "nav.loop",
    iconToken: "repeat",
    order: 110,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: [],
  },
  {
    // Phase 19a U5 — schema-driven settings surface (read/preview only). Read is
    // visible to every host; per-field edit gating (capability/permission) is
    // the schema's job, so no module-level constraints here. Unmounted whenever
    // the desktop_shell_v2 flag is OFF (the /settings page renders a placeholder).
    schemaVersion: DESKTOP_MODULE_SCHEMA_VERSION,
    id: "settings",
    route: "/settings",
    titleKey: "nav.settings",
    iconToken: "sliders-horizontal",
    order: 120,
    requiredCapabilities: [],
    requiredPermissions: [],
    load: loader,
    prefetch: () => {},
    commands: [],
    settingsSections: ["settings"],
  },
];

/** Host capabilities to test module visibility against. */
export interface ModuleCapabilitySet {
  readonly capabilities: readonly CapabilityToken[];
  readonly permissions: readonly PermissionToken[];
}

const includesAll = <T,>(available: readonly T[], required: readonly T[]): boolean =>
  required.every((r) => available.includes(r));

/**
 * Pure selector: modules visible to a host with the given capabilities and
 * permissions, in navigation order (deterministic, ascending `order`).
 */
export function visibleModules({ capabilities, permissions }: ModuleCapabilitySet): readonly DesktopModuleDefinition[] {
  return DESKTOP_MODULES.filter(
    (m) =>
      includesAll(capabilities, m.requiredCapabilities) &&
      includesAll(permissions, m.requiredPermissions),
  ).sort((a, b) => a.order - b.order);
}

/** Pure lookup by route; undefined when no module owns the route. */
export function findModuleByRoute(route: string): DesktopModuleDefinition | undefined {
  return DESKTOP_MODULES.find((m) => m.route === route);
}