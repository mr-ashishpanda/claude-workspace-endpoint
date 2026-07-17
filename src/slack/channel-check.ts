import { WebClient } from "@slack/web-api";

export interface ChannelCheckResult {
  ok: boolean;
  /** Human-readable reason, set when `ok` is false. */
  error?: string;
}

/** The slice of the Slack Web client channel validation needs. */
export interface ChannelCheckClient {
  conversations: {
    info(args: { channel: string }): Promise<{ channel?: { is_member?: boolean } }>;
  };
}

/**
 * Verify the bot can actually see the given channel before it's saved into a
 * mapping. Catches typos, wrong IDs, and "bot never invited" up front instead
 * of silently dropping every future Slack event for that channel (the bridge
 * never itself calls the Slack API to confirm a mapping's channel exists, so
 * without this check a bad channel id fails completely silently).
 */
export async function checkChannelAccess(
  botToken: string,
  channel: string,
  client: ChannelCheckClient = new WebClient(botToken),
): Promise<ChannelCheckResult> {
  try {
    const res = await client.conversations.info({ channel });
    if (res.channel?.is_member === false) {
      return {
        ok: false,
        error:
          "the bot is not a member of this channel — invite it (e.g. `/invite @your-bot`) and try again.",
      };
    }
    return { ok: true };
  } catch (err) {
    const slackError =
      typeof err === "object" && err !== null && "data" in err
        ? (err as { data?: { error?: string } }).data?.error
        : undefined;
    return { ok: false, error: slackError ?? (err instanceof Error ? err.message : String(err)) };
  }
}
