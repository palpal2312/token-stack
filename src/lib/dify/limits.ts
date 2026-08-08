/**
 * Dify integration limits for Agent OS MVP.
 *
 * These are hard local caps. Where Dify reports a comparable lower limit,
 * enforce min(local cap, Dify cap).
 */

/** Maximum number of saved workflow profiles */
export const DIFY_MAX_PROFILES = 32;

/** Maximum profile body size in bytes (128 KiB) */
export const DIFY_MAX_PROFILE_BODY_BYTES = 128 * 1024;

/** Maximum run body size in bytes excluding staged file bytes (256 KiB) */
export const DIFY_MAX_RUN_BODY_BYTES = 256 * 1024;

/** Maximum staged files per submission */
export const DIFY_MAX_STAGED_FILES = 10;

/** Maximum bytes per staged file (25 MiB) */
export const DIFY_MAX_STAGED_FILE_BYTES = 25 * 1024 * 1024;

/** Maximum aggregate staged bytes per submission (100 MiB) */
export const DIFY_MAX_STAGED_AGGREGATE_BYTES = 100 * 1024 * 1024;

/** Staged reference expiration in milliseconds (30 minutes) */
export const DIFY_STAGED_REF_TTL_MS = 30 * 60 * 1000;

/** Maximum total staged bytes across all active reservations (512 MiB) */
export const DIFY_MAX_TOTAL_STAGED_BYTES = 512 * 1024 * 1024;

/** Maximum info/parameters response size (2 MiB each) */
export const DIFY_METADATA_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Preflight metadata request timeout (10 seconds) */
export const DIFY_PREFLIGHT_TIMEOUT_MS = 10 * 1000;

/** Maximum upstream SSE frame size (2 MiB) */
export const DIFY_MAX_SSE_FRAME_BYTES = 2 * 1024 * 1024;

/** Maximum events per attached stream */
export const DIFY_MAX_STREAM_EVENTS = 50_000;

/** Maximum aggregate bytes per attached stream (64 MiB) */
export const DIFY_MAX_STREAM_AGGREGATE_BYTES = 64 * 1024 * 1024;

/** Stream idle timeout (120 seconds) */
export const DIFY_STREAM_IDLE_TIMEOUT_MS = 120 * 1000;

/** Stream attached wall time limit (30 minutes) */
export const DIFY_STREAM_WALL_TIME_MS = 30 * 60 * 1000;

/** Maximum run detail response size (16 MiB) */
export const DIFY_MAX_DETAIL_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Maximum error body size before truncation (32 KiB) */
export const DIFY_MAX_ERROR_BODY_BYTES = 32 * 1024;

/** Maximum output keys per run */
export const DIFY_MAX_OUTPUT_KEYS = 32;

/** Maximum bytes per normalized output value (10 MiB) */
export const DIFY_MAX_OUTPUT_VALUE_BYTES = 10 * 1024 * 1024;

/** Maximum aggregate output spool bytes per run (50 MiB) */
export const DIFY_MAX_OUTPUT_AGGREGATE_BYTES = 50 * 1024 * 1024;

/** Unmaterialized spool retention (7 days) */
export const DIFY_OUTPUT_SPOOL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum total spool bytes across all unmaterialized outputs (2 GiB) */
export const DIFY_MAX_TOTAL_SPOOL_BYTES = 2 * 1024 * 1024 * 1024;

/** Maximum artifacts per handoff */
export const DIFY_MAX_HANDOFF_ARTIFACTS = 16;

/** Maximum aggregate import bytes per handoff (50 MiB) */
export const DIFY_MAX_HANDOFF_IMPORT_BYTES = 50 * 1024 * 1024;

/** Maximum editing goal size (8 KiB) */
export const DIFY_MAX_HANDOFF_GOAL_BYTES = 8 * 1024;

/** Handoff TTL (30 minutes) */
export const DIFY_HANDOFF_TTL_MS = 30 * 60 * 1000;

/** Maximum connection revisions per profile */
export const DIFY_MAX_CONNECTION_REVISIONS = 8;

/** Maximum outstanding handoff records */
export const DIFY_MAX_OUTSTANDING_HANDOFFS = 128;

/** Maximum reserved import bytes across all created/claiming handoffs (512 MiB) */
export const DIFY_MAX_OUTSTANDING_HANDOFF_BYTES = 512 * 1024 * 1024;
