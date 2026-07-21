/**
 * Prepend a `[Slack: <sender>]` tag to a prompt, so a workspace's own CLAUDE.md
 * can detect the message came from Slack. The sender always includes the
 * Slack user id — unique and stable, unlike display/real names — paired with
 * the resolved name when `resolveUser` returns one that differs from the id
 * (i.e. the lookup actually succeeded): `<name> (<id>)`. When there is no
 * resolver, or the resolver degraded to the raw id (lookup failure), or there
 * is no user id at all, the tag falls back to just the id, or "unknown".
 * Fixed format — not user-templatable.
 */
export async function withSlackPrefix(
  text: string,
  userId: string | undefined,
  resolveUser: ((userId: string) => Promise<string>) | undefined,
): Promise<string> {
  const label = await buildLabel(userId, resolveUser);
  const tag = `[Slack: ${label}]`;
  return text ? `${tag} ${text}` : tag;
}

async function buildLabel(
  userId: string | undefined,
  resolveUser: ((userId: string) => Promise<string>) | undefined,
): Promise<string> {
  if (!userId) return "unknown";
  if (!resolveUser) return userId;
  const name = await resolveUser(userId);
  return name === userId ? userId : `${name} (${userId})`;
}
