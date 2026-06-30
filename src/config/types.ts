/** Domain types shared across the bridge. */

/** Session scope: one Claude session per channel, or one per thread. */
export type SessionScope = "channel" | "thread";

/** Trigger mode: invoke Claude only on @mention, or on every in-scope message. */
export type TriggerMode = "mention" | "auto";

export const SESSION_SCOPES: readonly SessionScope[] = ["channel", "thread"];
export const TRIGGER_MODES: readonly TriggerMode[] = ["mention", "auto"];

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
}

/** Persisted Claude session for one scope key. */
export interface SessionRecord {
  /** Scope key: channel_id, or channel_id + ":" + thread_ts. */
  key: string;
  /** Owning mapping identity. */
  identity: string;
  /** Claude Code session id, once established by the first invocation. */
  claudeSessionId: string | null;
  /** Number of messages routed to Claude for this session. */
  messagesProcessed: number;
  /** ISO timestamp when the session record was first created. */
  createdAt: string;
}
