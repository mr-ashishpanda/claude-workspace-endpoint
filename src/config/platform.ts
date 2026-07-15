import { homedir } from "node:os";
import { join } from "node:path";

/** Application slug used for all per-user directories. */
const APP = "slack-claude";

/**
 * Per-user directories where the bridge keeps its files when installed as a
 * standalone CLI. Split by purpose so we can follow each platform's conventions:
 *
 * - `config` — user-editable config + credentials (`.env`).
 * - `data`   — runtime state: mappings, sessions, cached media.
 * - `log`    — the bridge log file.
 *
 * Cross-platform: honors XDG on Linux, `%APPDATA%`/`%LOCALAPPDATA%` on Windows,
 * and `~/Library/...` on macOS. Everything returned is an absolute path.
 * `SLACK_CLAUDE_HOME` (handled in paths.ts) still overrides the data dir, and
 * a project-local `.env` still works in development — see config/env.ts.
 */
export interface PlatformDirs {
  config: string;
  data: string;
  log: string;
}

/** Trim an env value, returning undefined when blank so `??`/`||` fall back. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the platform-appropriate per-user directories. `env`/`platform` are
 * injectable so the behavior is unit-testable across operating systems.
 */
export function platformDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PlatformDirs {
  const home = homedir();

  if (platform === "win32") {
    const appData = nonEmpty(env.APPDATA) ?? join(home, "AppData", "Roaming");
    const localAppData = nonEmpty(env.LOCALAPPDATA) ?? join(home, "AppData", "Local");
    return {
      config: join(appData, APP, "Config"),
      data: join(localAppData, APP, "Data"),
      log: join(localAppData, APP, "Log"),
    };
  }

  if (platform === "darwin") {
    const appSupport = join(home, "Library", "Application Support", APP);
    return {
      config: appSupport,
      data: appSupport,
      log: join(home, "Library", "Logs", APP),
    };
  }

  // Linux and other Unixes: XDG Base Directory spec.
  const configBase = nonEmpty(env.XDG_CONFIG_HOME) ?? join(home, ".config");
  const stateBase = nonEmpty(env.XDG_STATE_HOME) ?? join(home, ".local", "state");
  const data = join(stateBase, APP);
  return {
    config: join(configBase, APP),
    data,
    log: join(data, "logs"),
  };
}
