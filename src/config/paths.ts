import { resolve } from "node:path";
import { platformDirs } from "./platform.js";

/**
 * Resolve the local storage root for bridge runtime state — mappings, sessions,
 * and cached media. Local-first: never a remote location.
 *
 * Resolution order:
 *   1. `SLACK_CLAUDE_HOME` if set (explicit override; also how dev pins storage
 *      to a project-local `.slack-claude/`).
 *   2. Otherwise the per-user, platform-appropriate data directory so the tool
 *      works the same no matter which directory it is launched from.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SLACK_CLAUDE_HOME?.trim();
  if (override) return resolve(override);
  return platformDirs(env).data;
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

/** Root directory for the audit trail (partitions + CLAUDE.md). */
export function auditDir(home: string): string {
  return resolve(home, "audit");
}

/** Global audit settings file (sibling of the audit/ data dir). */
export function auditConfigPath(home: string): string {
  return resolve(home, "audit-config.json");
}

/** Daily audit partition path, `audit/YYYY/MM/YYYY-MM-DD.jsonl` (UTC). */
export function auditPartitionPath(home: string, date: Date): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return resolve(auditDir(home), y, m, `${y}-${m}-${d}.jsonl`);
}
