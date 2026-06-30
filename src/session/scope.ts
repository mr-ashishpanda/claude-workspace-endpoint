import { SessionScope } from "../config/types.js";

/** A Slack message reduced to the fields routing/scoping need. */
export interface MessageContext {
  channel: string;
  /** Thread root timestamp; present when the message is in a thread. */
  threadTs?: string | undefined;
  /** This message's own timestamp. */
  ts: string;
}

/**
 * Compute the session key for a mapping's scope.
 *
 * - channel scope → `channel_id`
 * - thread  scope → `channel_id + ":" + thread_ts`
 *
 * For thread scope, a top-level message (no thread_ts) starts its own thread,
 * so the message's own `ts` becomes the thread root.
 */
export function sessionKey(scope: SessionScope, msg: MessageContext): string {
  if (scope === "channel") return msg.channel;
  const threadTs = msg.threadTs ?? msg.ts;
  return `${msg.channel}:${threadTs}`;
}

/**
 * The thread timestamp a reply should be posted under for a given scope.
 *
 * - channel scope → undefined (post directly to the channel, not in-thread)
 * - thread  scope → the thread root (existing thread_ts, else the message ts)
 */
export function replyThreadTs(scope: SessionScope, msg: MessageContext): string | undefined {
  if (scope === "channel") return undefined;
  return msg.threadTs ?? msg.ts;
}
