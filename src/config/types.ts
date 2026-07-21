/** Domain types shared across the bridge. */

/** Session scope: one Claude session per channel, or one per thread. */
export type SessionScope = "channel" | "thread";

/** Trigger mode: invoke Claude only on @mention, or on every in-scope message. */
export type TriggerMode = "mention" | "auto";

/**
 * Model family passed to Claude Code. `default` lets the CLI auto-pick the
 * latest model; the others select a family whose latest version the CLI resolves.
 */
export type ClaudeModel = "default" | "sonnet" | "opus" | "haiku";

export const SESSION_SCOPES: readonly SessionScope[] = ["channel", "thread"];
export const TRIGGER_MODES: readonly TriggerMode[] = ["mention", "auto"];
export const CLAUDE_MODELS: readonly ClaudeModel[] = ["default", "sonnet", "opus", "haiku"];

/**
 * A single channel-to-workspace mapping. The `identity` is unique across all
 * mappings and is surfaced in every Slack reply, log line, and status output.
 */
export interface Mapping {
  /** Unique Claude identity, e.g. "auth-investigator". */
  identity: string;
  /** Slack channel id (e.g. "C0123ABCD") this mapping is bound to. */
  channel: string;
  /** Absolute path to the local workspace directory Claude runs inside. */
  workspace: string;
  /** Session scope: channel or thread. */
  scope: SessionScope;
  /** Trigger mode: mention or auto. */
  trigger: TriggerMode;
  /** Model family for Claude Code invocations (`default` = CLI auto-picks latest). */
  model: ClaudeModel;
  /** Pass `--dangerously-skip-permissions` to Claude Code for this workspace. */
  skipPermissions: boolean;
  /** Prepend `[Slack: <sender>]` to every prompt sent to Claude for this mapping. */
  slackPrefix: boolean;
  /**
   * Optional custom `CLAUDE_CONFIG_DIR` for this mapping's `claude -p` runs, for
   * users who keep a separate Claude config (settings, MCP servers, auth).
   * Absolute path; omitted ⇒ inherit the bridge process's environment.
   */
  claudeConfigDir?: string;
}

/** Persisted Claude session for one scope key. */
export interface SessionRecord {
  /** Scope key: channel_id, or channel_id + ":" + thread_ts. */
  key: string;
  /** Owning mapping identity. */
  identity: string;
  /** Claude Code session id, once established by the first invocation. */
  claudeSessionId: string | null;
  /**
   * The `CLAUDE_CONFIG_DIR` in effect when `claudeSessionId` was established
   * (undefined = the bridge's default environment). Claude stores sessions per
   * config dir, so a session id is only resumable under the same one.
   */
  claudeConfigDir?: string;
  /** Number of messages routed to Claude for this session. */
  messagesProcessed: number;
  /** ISO timestamp when the session record was first created. */
  createdAt: string;
}

/** Global audit-trail settings (per-mapping overrides live on `Mapping.audit`). */
export interface AuditConfig {
  /** Record audit records at all. */
  enabled: boolean;
  /** Generate a Claude summary per record (the only token-costing part). */
  summary: boolean;
  /** Retention thresholds used by the `audit` maintenance commands. */
  retention: { compactAfterDays: number; pruneAfterDays: number };
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  enabled: false,
  summary: false,
  retention: { compactAfterDays: 90, pruneAfterDays: 1095 },
};

/**
 * Per-mapping override of the global `AuditConfig` (lives on `Mapping.audit`,
 * wired up in the mapping-override task). Unset fields fall back to the
 * global config.
 */
export interface MappingAuditOverride {
  enabled?: boolean;
  summary?: boolean;
}

/** Input/output token counts for one Claude call. */
export interface TokenUsage {
  input: number;
  output: number;
}

/** One audited Claude invocation. */
export interface AuditRecord {
  id: string;
  ts: string;
  slackTs: string;
  durationMs: number;
  user: string | null;
  userName: string | null;
  channel: string;
  channelName: string | null;
  threadTs: string | null;
  identity: string;
  workspace: string;
  sessionId: string | null;
  sessionRef: string | null;
  outcome: "success" | "error";
  error: string | null;
  tokens: TokenUsage;
  summaryTokens: TokenUsage | null;
  summary: string | null;
  summaryError: string | null;
}
