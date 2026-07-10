import { FileDownloader } from "./handler.js";
import { SlackFile } from "./files.js";

/**
 * Build a {@link FileDownloader} that fetches a Slack file's `url_private` with
 * the bot token. Slack requires `Authorization: Bearer <token>` on these URLs;
 * the token comes from credentials/env and is never logged. `fetchImpl` is
 * injectable so the request shaping is testable without a network.
 */
export function createFileDownloader(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): FileDownloader {
  return async (file: SlackFile): Promise<Buffer> => {
    const res = await fetchImpl(file.urlPrivate, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) {
      throw new Error(`failed to download ${file.name}: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  };
}
