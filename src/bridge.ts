import { join } from "node:path";
import { loadEnv } from "./config/env.js";
import { platformDirs } from "./config/platform.js";
import { createRootLogger } from "./logger.js";
import { resolveHome } from "./config/paths.js";
import { MissingCredentialsError, claudeBin, loadCredentials } from "./config/credentials.js";
import { MappingStore } from "./config/mappings.js";
import { SessionStore } from "./session/store.js";
import { KeyedSerializer } from "./session/serializer.js";
import { MediaStore } from "./session/media.js";
import { createSlackApp } from "./slack/app.js";
import { createFileDownloader } from "./slack/download.js";
import { createUserResolver } from "./slack/user-lookup.js";
import { removePidFile, writePidFile } from "./daemon/pidfile.js";

export interface RunBridgeOptions {
  /** Called once the bridge is connected to Slack and ready to route messages. */
  onReady?: (pid: number) => void;
  /** Called when startup fails before the bridge ever connects. */
  onFatal?: (message: string) => void;
}

/**
 * Start the bridge: load env, wire config + stores + the Slack app, then run
 * until a termination signal. Shared by the `slack-claude run` CLI command and
 * the `node dist/index.js` entrypoint used in development.
 */
export async function runBridge(opts: RunBridgeOptions = {}): Promise<void> {
  loadEnv();

  // Default the log file to the per-user log dir when the operator hasn't
  // pinned one (e.g. a project-local logs/bridge.log in development).
  if (!process.env.LOG_FILE?.trim()) {
    process.env.LOG_FILE = join(platformDirs().log, "bridge.log");
  }

  const logger = createRootLogger();
  const home = resolveHome();
  logger.info(`storage home: ${home}`);

  let creds;
  try {
    creds = loadCredentials();
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      logger.error(err.message);
      opts.onFatal?.(err.message);
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
  const userResolver = createUserResolver(creds.botToken, logger);

  const app = createSlackApp(
    creds,
    {
      mappings,
      sessions,
      logger,
      claudeBin: claudeBin(),
      serializer,
      media,
      download,
      resolveUser: (id) => userResolver.resolve(id),
    },
    logger,
  );

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down…`);
    try {
      await app.stop();
    } finally {
      removePidFile(home);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.start();
  writePidFile(home, process.pid);
  opts.onReady?.(process.pid);
}
