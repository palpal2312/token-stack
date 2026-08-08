import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { kanbanRoot } from "./store";
import {
  DEFAULT_ROLE_CONFIG,
  type KanbanRoleChoice,
  type KanbanRoleConfig,
} from "./types";

function configFile(): string { return path.join(kanbanRoot(), "config.json"); }

function normalizeChoice(value: unknown, fallback: KanbanRoleChoice): KanbanRoleChoice {
  if (!value || typeof value !== "object") return { ...fallback };
  const raw = value as Record<string, unknown>;
  const engine = raw.engine === "builder" || raw.engine === "hermes" || raw.engine === "ollama"
    ? raw.engine : fallback.engine;
  return {
    engine,
    ...(typeof raw.builderId === "string" && raw.builderId ? { builderId: raw.builderId } : {}),
  };
}

export async function readKanbanConfig(): Promise<KanbanRoleConfig> {
  try {
    const parsed = JSON.parse(await readFile(configFile(), "utf8")) as Partial<KanbanRoleConfig>;
    return {
      planner: normalizeChoice(parsed.planner, DEFAULT_ROLE_CONFIG.planner),
      builder: normalizeChoice(parsed.builder, DEFAULT_ROLE_CONFIG.builder),
      reviewer: normalizeChoice(parsed.reviewer, DEFAULT_ROLE_CONFIG.reviewer),
    };
  } catch { return structuredClone(DEFAULT_ROLE_CONFIG); }
}

export async function writeKanbanConfig(input: Partial<KanbanRoleConfig>): Promise<KanbanRoleConfig> {
  const current = await readKanbanConfig();
  const next: KanbanRoleConfig = {
    planner: normalizeChoice(input.planner, current.planner),
    builder: normalizeChoice(input.builder, current.builder),
    reviewer: normalizeChoice(input.reviewer, current.reviewer),
  };
  await mkdir(kanbanRoot(), { recursive: true });
  const target = configFile();
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return next;
}

