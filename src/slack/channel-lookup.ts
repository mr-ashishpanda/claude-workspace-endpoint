import { WebClient } from "@slack/web-api";
import { Logger } from "../logger.js";

export interface ChannelLookupClient {
  conversations: {
    info(args: { channel: string }): Promise<{ channel?: { name?: string } }>;
  };
}

/**
 * Resolves a Slack channel id to `#name` for audit records. Same cache/fallback
 * discipline as {@link UserResolver}: successes cached for the process lifetime,
 * failures fall back to the raw id and are not cached (self-heal next call).
 */
export class ChannelResolver {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly client: ChannelLookupClient,
    private readonly logger?: Logger,
  ) {}

  async resolve(channelId: string): Promise<string> {
    const cached = this.cache.get(channelId);
    if (cached) return cached;
    try {
      const res = await this.client.conversations.info({ channel: channelId });
      const name = res.channel?.name?.trim();
      const label = name ? `#${name}` : channelId;
      if (name) this.cache.set(channelId, label);
      return label;
    } catch (err) {
      const slackError =
        typeof err === "object" && err !== null && "data" in err
          ? (err as { data?: { error?: string } }).data?.error
          : undefined;
      const reason = slackError ?? (err instanceof Error ? err.message : String(err));
      this.logger?.warn(`failed to resolve channel name for ${channelId}: ${reason}`);
      return channelId;
    }
  }
}

export function createChannelResolver(
  botToken: string,
  logger?: Logger,
  client: ChannelLookupClient = new WebClient(botToken),
): ChannelResolver {
  return new ChannelResolver(client, logger);
}
