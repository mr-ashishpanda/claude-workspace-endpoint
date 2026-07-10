import { resolve } from "node:path";

/**
 * Resolve the local storage root (SLACK_CLAUDE_HOME). All bridge runtime
 * state — mappings and sessions — lives here. Local-first: never a remote
 * location. Defaults to `.slack-claude/` in the current working directory.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.SLACK_CLAUDE_HOME?.trim() || ".slack-claude";
  return resolve(home);
}

/** Path to the mappings file inside the storage root. */
export function mappingsPath(home: string): string {
  return resolve(home, "mappings.json");
}

/** Path to the sessions file inside the storage root. */
export function sessionsPath(home: string): string {
  return resolve(home, "sessions.json");
}

/**
 * Directory under the storage root where Slack image downloads are cached, so
 * headless `claude` can read them by absolute path. Local-first: app data dir,
 * never the mapped workspace/repo.
 */
export function mediaDir(home: string): string {
  return resolve(home, "media");
}
