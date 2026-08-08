// The shape every CLI module under `clis/` exports: one `CliSpec` per CLI.
//
// A Builder is one runnable configuration of a CLI — binary + auth identity +
// env — so one CLI can host several accounts. The spec says, per CLI, how to
// give a profile its own identity, how to ask it for a version, and how to run
// one non-interactive turn.
//
// `id` is a catalog key, deliberately not a closed enum: virtual CLIs (fcc runs
// the claude binary with proxy env) and the test fixture both need entries, and
// the skins work reuses this same list.
//
// Isolation notes are marked with how they were established. "verified here"
// means it was tested on a real install; "documented" means the vendor documents
// the variable but nobody has proven it on this machine yet. Never promise
// multi-account support on a guess — a wrong guess silently shares one login
// between two profiles that look separate in the UI.

export type Protocol = "claude-stream-json" | "kimi-stream-json" | "codex-exec-json" | "agy-stream-json" | "text";
export type AuthKind = "oauth" | "api" | "none";

export type PreExecutionToolCapability =
  | {
      status: "proven";
      callId: true;
      boundedArguments: true;
      pauseBoundary: true;
      toolResultContinuation: true;
      /** Phase 2 never enables side-effecting approval mediation. */
      mediation: "disabled-pending-durable-resume";
    }
  | {
      status: "unsupported";
      reason: string;
    };

export interface CliCapabilityDeclaration {
  nativeActivityTelemetry: boolean;
  governedExecution: boolean;
  /** Structured, pre-execution capability only; post-hoc activity is not proof. */
  preExecutionTools: PreExecutionToolCapability;
  unsupportedReason?: string;
}

export interface CliSpec {
  id: string;
  label: string;
  /** Key in the global config holding this CLI's default binary. */
  configKey: string | null;
  /** Virtual CLI: run another catalog entry's binary (fcc → claude). */
  binOf?: string;
  /** Resolver for CLIs whose path lives outside the shared config. */
  resolveBin?: () => string | null;
  protocol: Protocol;
  /** Explicit proof boundary for governed execution and native CLI telemetry. */
  capability?: CliCapabilityDeclaration;
  authKinds: AuthKind[];
  /** Env var an API key goes in, so the UI can label the field correctly. */
  apiKeyEnv: string | null;
  /** Env var that repoints this CLI's credential/config directory, if any. */
  isolationEnv: string | null;
  /** True only when isolation is proven, not assumed. */
  multiProfile: boolean;
  versionArgs: string[];
  /**
   * This CLI only exposes auth/quota inside its TUI (kimi's /usage panel).
   * The health probe drives the TUI through a PTY and parses the panel.
   */
  usageViaTui?: boolean;
  /**
   * This CLI refuses to run without a console (verified: agy.exe 1.1.8 exits
   * immediately with no stdout, no stderr and a null exit code when spawned on
   * a plain pipe). The chat lane spawns it through node-pty instead of
   * child_process.spawn — see lib/builders/ptySpawn.ts. Only set where the
   * pipe failure was observed on a real install, never on a guess.
   */
  requiresPty?: boolean;
  /**
   * A free, non-interactive command that reports whether THIS invocation is
   * authenticated (e.g. `claude auth status`, `codex login status`). It must
   * respect the CLI's isolation variable so per-profile answers differ. Only
   * set where the command has been run and read on a real install.
   */
  authStatusArgs?: string[];
  /** Args for an interactive login, run in the user's own terminal. */
  loginArgs: string[] | null;
  /** One non-interactive turn. */
  execArgs: (prompt: string, opts?: ExecOpts) => string[];
  /**
   * One non-interactive turn RESUMING this CLI's own earlier session — the
   * fast path for chat: the CLI already holds the history and the system
   * context, so nothing is re-packed or re-bootstrapped. Only set where the
   * exact argv was verified against the real CLI. Resume ids come from the
   * stream itself (see LineExtractor); never from `--last`-style lookups.
   */
  resumeArgs?: (sessionId: string, prompt: string, opts?: ExecOpts) => string[];
  /**
   * Args that turn the CLI into a persistent ACP (Agent Client Protocol)
   * stdio server — e.g. kimi's `["acp"]`. Presence means the fast chat lane
   * (lib/builders/acp.ts) can serve this CLI: one long-lived process with
   * token-level streaming instead of a cold one-shot per turn. Only set where
   * the handshake was verified against the real binary.
   */
  acpArgv?: string[];
  /** Which protocol the lane speaks over acpArgv. Default "acp". */
  laneProtocol?: "acp" | "claude-duplex" | "codex-appserver";
  /**
   * The CLI's workflow contract: a plain-language description of the loop this
   * CLI runs plus the knobs an orchestrator may turn through this CLI's own
   * native args. Sen reads this (via list_workers) BEFORE delegating and
   * picks knob values that match the user's intent; delegate_task validates and
   * translates the choice through `argsFor`. Only verified flags belong here —
   * a knob whose args were never run against the real binary is a guess the
   * orchestrator will trust.
   */
  workflow?: {
    /** Mô tả loop/workflow native của CLI — để orchestrator đọc trước khi giao việc. */
    summary: string;
    knobs: Array<{
      id: string; // "permission" | "mode" | "sandbox"
      description: string;
      /** Chỉ giá trị đã verify. */
      values: string[];
      /**
       * False when the knob only exists in the CLI's interactive TUI and the
       * CLI itself rejects it in print mode (kimi forbids `-p` combined with
       * --yolo/--auto/--plan — verified 0.29.2). Delegation runs print mode,
       * so an orchestrator must not set such a knob; delegate_task rejects it
       * with an explanation instead of the CLI's cryptic exit-1.
       */
      printCompatible?: boolean;
      /** Args nối thêm khi knob = value; "default" phải trả []. */
      argsFor: (value: string) => string[];
    }>;
  };
  notes: string;
}

export interface ExecOpts { model?: string | null; effort?: string | null }
