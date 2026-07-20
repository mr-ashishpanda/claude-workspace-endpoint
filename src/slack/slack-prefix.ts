/**
 * Prepend a `[Slack: <sender>]` tag to a prompt, so a workspace's own CLAUDE.md
 * can detect the message came from Slack. The sender is resolved via
 * `resolveUser` when both it and `userId` are present, else the raw Slack user
 * id is used, else "unknown". Fixed format — not user-templatable.
 */
export async function withSlackPrefix(
  text: string,
  userId: string | undefined,
  resolveUser: ((userId: string) => Promise<string>) | undefined,
): Promise<string> {
  const label = userId ? (resolveUser ? await resolveUser(userId) : userId) : "unknown";
  const tag = `[Slack: ${label}]`;
  return text ? `${tag} ${text}` : tag;
}
