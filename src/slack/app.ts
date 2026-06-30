import bolt from "@slack/bolt";
import { Logger } from "../logger.js";
import { SlackCredentials } from "../config/credentials.js";
import { HandlerDeps, handleInbound } from "./handler.js";
import { InboundMessage } from "./router.js";

const { App } = bolt;

/** Minimal shape of the Slack message events we care about. */
interface RawMessage {
  subtype?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  user?: string;
}

/** Convert a Bolt message event + bot id into our normalized InboundMessage. */
export function normalizeMessage(raw: RawMessage, botUserId: string): InboundMessage | null {
  // Only plain user messages; skip edits, deletes, joins, bot posts, etc.
  if (raw.subtype && raw.subtype !== "thread_broadcast") return null;
  if (!raw.channel || !raw.ts) return null;
  const text = raw.text ?? "";
  return {
    channel: raw.channel,
    ts: raw.ts,
    threadTs: raw.thread_ts,
    text,
    mentionsBot: text.includes(`<@${botUserId}>`),
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
