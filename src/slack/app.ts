import bolt from "@slack/bolt";
import { Logger } from "../logger.js";
import { SlackCredentials } from "../config/credentials.js";
import { HandlerDeps, handleInbound } from "./handler.js";
import { InboundMessage } from "./router.js";

const { App } = bolt;

/** A leaf node inside a rich_text section. */
interface RichTextLeaf {
  type: string;
  text?: string;
  user_id?: string;
  channel_id?: string;
  name?: string;
  url?: string;
  range?: string;
}

/**
 * A block element: rich_text_section / _list / _quote / _preformatted (which
 * carry `elements`), or other block elements like context `mrkdwn` (which carry
 * `text`). Only rich_text sections are read; the rest are tolerated and ignored.
 */
interface RichTextElement {
  type: string;
  elements?: RichTextLeaf[];
  text?: string;
}

/** A top-level Slack message block. */
interface Block {
  type: string;
  elements?: RichTextElement[];
}

/** Minimal shape of the Slack message events we care about. */
interface RawMessage {
  subtype?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  user?: string;
  blocks?: Block[];
}

/** Render one rich_text leaf back into Slack's mrkdwn token form. */
function renderLeaf(leaf: RichTextLeaf): string {
  switch (leaf.type) {
    case "text":
      return leaf.text ?? "";
    case "user":
      return leaf.user_id ? `<@${leaf.user_id}>` : "";
    case "channel":
      return leaf.channel_id ? `<#${leaf.channel_id}>` : "";
    case "emoji":
      return leaf.name ? `:${leaf.name}:` : "";
    case "link":
      return leaf.text ?? leaf.url ?? "";
    case "broadcast":
      return leaf.range ? `<!${leaf.range}>` : "";
    default:
      return leaf.text ?? "";
  }
}

/**
 * Extract the user-authored text from a message. Slack apps/integrations append
 * `context` blocks (e.g. a "Sent using …" footer) that get flattened into the
 * `text` field — polluting prompts and breaking exact-match commands like
 * `@claude status`. When `rich_text` blocks are present, reconstruct the text
 * from those (the authored content) and ignore context blocks; otherwise fall
 * back to the flat `text` field.
 */
export function extractText(raw: RawMessage): string {
  const richText = (raw.blocks ?? []).filter((b) => b.type === "rich_text");
  if (richText.length === 0) return raw.text ?? "";
  const parts: string[] = [];
  for (const block of richText) {
    for (const section of block.elements ?? []) {
      for (const leaf of section.elements ?? []) {
        parts.push(renderLeaf(leaf));
      }
    }
  }
  const reconstructed = parts.join("").trim();
  return reconstructed || (raw.text ?? "");
}

/**
 * True if `text` @-mentions `userId`. Slack encodes a mention as `<@U123>` or,
 * when a display name is present, `<@U123|Some Name>` — match either form.
 */
export function mentionsUser(text: string, userId: string): boolean {
  if (!userId) return false;
  return new RegExp(`<@${userId}(?:\\|[^>]+)?>`).test(text);
}

/** Convert a Bolt message event + bot id into our normalized InboundMessage. */
export function normalizeMessage(raw: RawMessage, botUserId: string): InboundMessage | null {
  // Only plain user messages; skip edits, deletes, joins, bot posts, etc.
  if (raw.subtype && raw.subtype !== "thread_broadcast") return null;
  if (!raw.channel || !raw.ts) return null;
  const text = extractText(raw);
  return {
    channel: raw.channel,
    ts: raw.ts,
    threadTs: raw.thread_ts,
    text,
    mentionsBot: mentionsUser(text, botUserId),
    fromBot: Boolean(raw.bot_id),
  };
}

export interface BridgeApp {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The slice of the Slack Web client the message handler uses. */
export interface SlackPostClient {
  chat: {
    postMessage(args: { channel: string; text: string; thread_ts?: string }): Promise<unknown>;
  };
}

/**
 * Build the message-handling callback: normalize the raw event, and on a real
 * message route it through the handler, posting replies via the client. Bolt's
 * `client.web` shape is injected so this glue is testable without a connection.
 */
export function makeMessageHandler(
  deps: Omit<HandlerDeps, "post">,
  getBotUserId: () => string,
): (message: RawMessage, client: SlackPostClient) => Promise<void> {
  return async (message, client) => {
    const msg = normalizeMessage(message, getBotUserId());
    if (!msg) return;
    const post: HandlerDeps["post"] = async (channel, text, threadTs) => {
      await client.chat.postMessage({
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
    };
    await handleInbound({ ...deps, post }, msg);
  };
}

/**
 * Build the Bolt app in Socket Mode and wire message events to the handler.
 * No public inbound endpoint is opened (local-first).
 */
export function createSlackApp(
  creds: SlackCredentials,
  deps: Omit<HandlerDeps, "post">,
  logger: Logger,
): BridgeApp {
  const app = new App({
    token: creds.botToken,
    appToken: creds.appToken,
    signingSecret: creds.signingSecret,
    socketMode: true,
    logger: {
      debug: (...m) => logger.debug(m.join(" ")),
      info: (...m) => logger.debug(m.join(" ")),
      warn: (...m) => logger.warn(m.join(" ")),
      error: (...m) => logger.error(m.join(" ")),
      setLevel: () => {},
      getLevel: () => "info" as bolt.LogLevel,
      setName: () => {},
    },
  });

  let botUserId = "";
  const onMessage = makeMessageHandler(deps, () => botUserId);

  app.message(async ({ message, client }) => {
    await onMessage(message as RawMessage, client as SlackPostClient);
  });

  return {
    async start() {
      const auth = await app.client.auth.test({ token: creds.botToken });
      botUserId = (auth.user_id as string) ?? "";
      logger.info(`authenticated as bot user ${botUserId}`);
      await app.start();
      logger.info("bridge connected to Slack (Socket Mode)");
      const channels = new Set(deps.mappings.list().map((m) => m.channel));
      logger.info(
        `routing ${deps.mappings.list().length} mapping(s) across ` + `${channels.size} channel(s)`,
      );
    },
    async stop() {
      await app.stop();
      logger.info("bridge disconnected from Slack");
    },
  };
}
