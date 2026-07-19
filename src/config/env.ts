import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import dotenv from "dotenv";
import { platformDirs } from "./platform.js";

/**
 * Absolute path to the standalone `.env` in the per-user config directory. This
 * is where `slack-claude init` writes credentials so they load no matter which
 * directory the bridge is launched from.
 */
export function configEnvPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(platformDirs(env, platform).config, ".env");
}

/**
 * Populate `process.env` from `.env` files, then return. Precedence (highest
 * wins): the real process environment, then a project-local `.env` (development
 * from a clone), then the per-user config `.env` (standalone install). dotenv
 * never overrides already-set variables, so loading the local file first lets a
 * developer's project `.env` take priority while the config `.env` fills gaps.
 *
 * Both files are optional; a missing file is simply skipped.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): void {
  const localEnv = resolve(".env");
  if (existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
  }
  const configEnv = configEnvPath(env);
  if (existsSync(configEnv)) {
    dotenv.config({ path: configEnv });
  }
}
