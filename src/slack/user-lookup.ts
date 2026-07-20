import { WebClient } from "@slack/web-api";

/** The slice of the Slack Web client user-lookup needs. */
export interface UserLookupClient {
  users: {
    info(args: { user: string }): Promise<{
      user?: { real_name?: string; name?: string; profile?: { display_name?: string } };
    }>;
  };
}

/**
 * Resolves a Slack user id to a human-readable display name, for the
 * `[Slack: <name>]` prefix. Caches successful lookups in memory for the
 * process lifetime (Slack user ids and their display names are effectively
 * static for a running bridge). A lookup that throws (rate limit, missing
 * `users:read` scope, network error) falls back to the raw id and is
 * deliberately NOT cached, so a transient failure self-heals on the next
 * message instead of sticking for the bridge's uptime.
 */
export class UserResolver {
  private readonly cache = new Map<string, string>();

  constructor(private readonly client: UserLookupClient) {}

  async resolve(userId: string): Promise<string> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    try {
      const res = await this.client.users.info({ user: userId });
      const name =
        res.user?.profile?.display_name?.trim() ||
        res.user?.real_name?.trim() ||
        res.user?.name?.trim() ||
        userId;
      this.cache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }
}

/** Real-world factory: a `UserResolver` backed by the Slack Web API. */
export function createUserResolver(
  botToken: string,
  client: UserLookupClient = new WebClient(botToken),
): UserResolver {
  return new UserResolver(client);
}
