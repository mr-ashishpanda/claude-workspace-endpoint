import "dotenv/config";
import { createRootLogger } from "./logger.js";
import { resolveHome } from "./config/paths.js";
import { MissingCredentialsError, claudeBin, loadCredentials } from "./config/credentials.js";
import { MappingStore } from "./config/mappings.js";
import { SessionStore } from "./session/store.js";
import { KeyedSerializer } from "./session/serializer.js";
import { MediaStore } from "./session/media.js";
import { createSlackApp } from "./slack/app.js";
import { createFileDownloader } from "./slack/download.js";

/** Bridge entrypoint: wire config + stores + Slack app, then run. */
async function main(): Promise<void> {
  const logger = createRootLogger();
  const home = resolveHome();
  logger.info(`storage home: ${home}`);

  let creds;
  try {
    creds = loadCredentials();
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      logger.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const mappings = MappingStore.load(home);
  if (mappings.list().length === 0) {
    logger.warn("no mappings configured — run `slack-claude map add` to create one.");
  }
  const sessions = SessionStore.load(home);
  const serializer = new KeyedSerializer();
  const media = new MediaStore(home);
  const download = createFileDownloader(creds.botToken);

  const app = createSlackApp(
    creds,
    { mappings, sessions, logger, claudeBin: claudeBin(), serializer, media, download },
    logger,
  );

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down…`);
    try {
      await app.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
