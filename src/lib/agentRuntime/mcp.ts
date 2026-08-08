// The MCP bridge: "any tool over MCP" instead of 25 native connectors
// (docs/openworker-aisuite-capability-map.md §2.4, aisuite's MCPClient
// pattern). One client per configured server; the server's tools become
// RuntimeTools the runner can hand to a brain like any local toolkit.
//
// Three rules shape everything below:
//
//   * Filtering happens at exposure time, not at call time. A tool the
//     config does not allow is never listed to the model — a denied tool
//     the model cannot see is one it cannot talk its way into.
//   * Prefixing makes the toolbox greppable: `${server}__${tool}` (when
//     usePrefix is on, the default) so a trace line names WHICH server ran,
//     and two servers exposing "search" never collide.
//   * Declared limits are enforced limits. callTimeoutMs defaults to 30s
//     and is passed to every callTool — a wedged server must fail one tool
//     result, never hang a run. Same philosophy as the shell toolkit's
//     killer timer.
//
// Servers are user-configured and never auto-installed: this module only
// ever connects to what the store already holds (Integrations philosophy —
// detect and report, never install).
//
// No new dependency: @modelcontextprotocol/sdk was already in package.json.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RuntimeTool } from "./agent";

export const MCP_CALL_TIMEOUT_MS = 30_000;

/** One user-configured MCP server — the shape the store persists. */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  /** stdio: the executable to spawn. */
  command?: string;
  args?: string[];
  /** stdio: extra environment, merged over the SDK's safe-inherit set. */
  env?: Record<string, string>;
  /** http: the server's endpoint (streamable HTTP, SSE fallback). */
  url?: string;
  /** http: extra request headers — usually the auth header, so these are masked in the public shape. */
  headers?: Record<string, string>;
  /** Exposed tool names (the server's own, unprefixed). Absent = everything. */
  allowedTools?: string[];
  /** Prefix exposed tools as `${name}__${tool}`. Default true. */
  usePrefix?: boolean;
  /** Per-call timeout. Default MCP_CALL_TIMEOUT_MS (30s) — enforced on every callTool. */
  callTimeoutMs?: number;
}

function explain(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/** A connected server. Call close() when the run is done — a stdio server is a child process. */
export class McpClient {
  private client: Client | null = null;

  constructor(public readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client(
      { name: "agent-os-runtime", version: "1.0.0" },
      { capabilities: {} },
    );
    if (this.config.transport === "stdio") {
      if (!this.config.command) throw new Error(`MCP server "${this.config.name}" is stdio but names no command.`);
      await client.connect(new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        // The config's env is merged OVER the safe-inherit set: an explicit
        // env replaces PATH lookups wholesale otherwise, and "server would
        // not start" is the worst kind of why.
        env: { ...getDefaultEnvironment(), ...(this.config.env ?? {}) },
        // Server diagnostics go to this process's stderr — a failed server
        // should leave its last words where the dashboard logs can see them.
        stderr: "inherit",
      }));
    } else {
      if (!this.config.url) throw new Error(`MCP server "${this.config.name}" is http but names no URL.`);
      const url = new URL(this.config.url);
      const requestInit = this.config.headers ? { headers: this.config.headers } : undefined;
      try {
        await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
      } catch (e) {
        // Older servers speak plain SSE only. Fall back once; if that fails
        // too, the original error is the better explanation.
        try {
          await client.connect(new SSEClientTransport(url, { requestInit }));
        } catch {
          throw e;
        }
      }
    }
    this.client = client;
  }

  private requireClient(): Client {
    if (!this.client) throw new Error(`MCP server "${this.config.name}" is not connected.`);
    return this.client;
  }

  /** The server's tools after allow-filtering and prefixing, as runtime tools. */
  async runtimeTools(): Promise<RuntimeTool[]> {
    const client = this.requireClient();
    const { tools } = await client.listTools(undefined, { timeout: this.timeout() });
    const allowed = this.config.allowedTools ? new Set(this.config.allowedTools) : null;
    const usePrefix = this.config.usePrefix !== false;

    return tools
      .filter((t) => !allowed || allowed.has(t.name))
      .map((t) => {
        const exposed = usePrefix ? `${this.config.name}__${t.name}` : t.name;
        const serverTool = t.name;
        return {
          name: exposed,
          description: `[MCP ${this.config.name}] ${t.description ?? serverTool}`,
          schema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
          // Everything an MCP server does is outside this process — reads and
          // writes alike — so RequireApproval gates the lot by default.
          metadata: { riskLevel: "external" as const },
          execute: async (args: unknown) => {
            const result = await this.requireClient().callTool(
              { name: serverTool, arguments: (args ?? {}) as Record<string, unknown> },
              undefined,
              { timeout: this.timeout() },
            );
            const text = textOf(result.content);
            if (result.isError) return { error: text || "The MCP server reported an error with no message." };
            return { result: text };
          },
        } satisfies RuntimeTool;
      });
  }

  private timeout(): number {
    return this.config.callTimeoutMs ?? MCP_CALL_TIMEOUT_MS;
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => {});
  }
}

/** The wire result's text: the first text part, or every text part joined. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content ?? null);
  const texts = content
    .filter((p): p is { type: "text"; text: string } =>
      typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text")
    .map((p) => p.text);
  return texts.length ? texts.join("\n") : JSON.stringify(content);
}

export interface McpToolbox {
  tools: RuntimeTool[];
  /** Servers that would not connect, named with their reason — reported, never retried silently. */
  errors: { name: string; error: string }[];
  /** Close every server that did connect. */
  close(): Promise<void>;
}

/**
 * Connect every listed server and collect its tools. A server that refuses
 * is named in `errors` and its tools skipped — one dead connector must not
 * take down the whole toolbox (detect and report).
 */
export async function mcpToolbox(configs: McpServerConfig[]): Promise<McpToolbox> {
  const tools: RuntimeTool[] = [];
  const errors: { name: string; error: string }[] = [];
  const clients: McpClient[] = [];
  for (const cfg of configs) {
    const client = new McpClient(cfg);
    try {
      await client.connect();
      tools.push(...await client.runtimeTools());
      clients.push(client);
    } catch (e) {
      errors.push({ name: cfg.name, error: explain(e) });
      await client.close();
    }
  }
  return {
    tools,
    errors,
    async close() {
      await Promise.all(clients.map((c) => c.close()));
    },
  };
}
