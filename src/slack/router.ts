import { Mapping } from "../config/types.js";
import { MessageContext, replyThreadTs, sessionKey } from "../session/scope.js";
import { SlackFile } from "./files.js";

/** A normalized inbound Slack message, decoupled from Bolt's event shapes. */
export interface InboundMessage extends MessageContext {
  /** Raw message text. */
  text: string;
  /** True if the bot user is @-mentioned in the text. */
  mentionsBot: boolean;
  /** True if the message was produced by a bot (including ourselves). */
  fromBot: boolean;
  /** File attachments on the message (empty/omitted when none). */
  files?: SlackFile[];
  /** Slack user id of the sender (absent for message subtypes without one). */
  user?: string;
}

export type RouteAction = "ignore" | "status" | "invoke";

export interface RouteDecision {
  action: RouteAction;
  /** Scope session key (set for status + invoke). */
  sessionKey?: string;
  /** Thread ts to post the reply under (undefined = post to channel). */
  replyThreadTs?: string | undefined;
  /** Prompt text to send to Claude (set for invoke). */
  prompt?: string;
}

/**
 * Strip every mention token and collapse whitespace. Slack encodes mentions as
 * `<@U123>` or, with a display name, `<@U123|Some Name>` — handle both.
 */
export function stripMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the (mention-stripped) text is exactly the `status` command. */
export function isStatusCommand(text: string): boolean {
  return stripMentions(text).toLowerCase() === "status";
}

/**
 * Decide what to do with an inbound message for a given mapping. Pure: no I/O,
 * so every scope×trigger combination is unit-testable.
 *
 * Rules:
 * - Messages from bots (incl. ourselves) are always ignored — no loops.
 * - `@claude status` (mention + "status") always returns status, regardless of
 *   trigger mode.
 * - mention trigger: invoke only when the bot is mentioned; else ignore.
 * - auto trigger: invoke on every in-scope message.
 */
export function route(mapping: Mapping, msg: InboundMessage): RouteDecision {
  if (msg.fromBot) return { action: "ignore" };

  const key = sessionKey(mapping.scope, msg);
  const thread = replyThreadTs(mapping.scope, msg);

  // The single supported Slack command: @claude status.
  if (msg.mentionsBot && isStatusCommand(msg.text)) {
    return { action: "status", sessionKey: key, replyThreadTs: thread };
  }

  if (mapping.trigger === "mention" && !msg.mentionsBot) {
    return { action: "ignore" };
  }

  const prompt = mapping.trigger === "mention" ? stripMentions(msg.text) : msg.text;
  // Attachments are content too: a file-only message (no text) still triggers,
  // subject to the same mention/auto gating above.
  const hasAttachments = (msg.files?.length ?? 0) > 0;
  if (!prompt.trim() && !hasAttachments) return { action: "ignore" };

  return {
    action: "invoke",
    sessionKey: key,
    replyThreadTs: thread,
    prompt,
  };
}
