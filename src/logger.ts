import {
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE,
  getFileSink,
  parseByteLimit,
  RotatingFileSink,
} from "./log-sink.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

/**
 * One logger for the whole bridge. Every line is prefixed with the mapping
 * identity (or "bridge" for process-level lines) so Slack/log correlation is
 * always possible. Writes to both stdout/stderr and an optional log file.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly sink: RotatingFileSink | undefined;

  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly identity: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.env = env;
    this.level = configuredLevel(env);
    const file = env.LOG_FILE?.trim();
    if (file) {
      const maxSize = parseByteLimit(env.LOG_MAX_SIZE, DEFAULT_LOG_MAX_SIZE);
      const maxFiles = parseByteLimit(env.LOG_MAX_FILES, DEFAULT_LOG_MAX_FILES);
      // Shared per-path so all identity-scoped loggers rotate one file together.
      this.sink = getFileSink(file, maxSize, maxFiles);
    }
  }

  /** Derive a child logger bound to a specific mapping identity. */
  withIdentity(identity: string): Logger {
    return new Logger(identity, this.env);
  }

  debug(msg: string): void {
    this.write("debug", msg);
  }
  info(msg: string): void {
    this.write("info", msg);
  }
  warn(msg: string): void {
    this.write("warn", msg);
  }
  error(msg: string): void {
    this.write("error", msg);
  }

  private write(level: LogLevel, msg: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const ts = new Date().toISOString();
    const line = `${ts} [${level.toUpperCase()}] [${this.identity}] ${msg}`;
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
    this.sink?.append(line);
  }
}

/** The process-level logger; mapping handlers derive children via withIdentity. */
export function createRootLogger(env: NodeJS.ProcessEnv = process.env): Logger {
  return new Logger("bridge", env);
}
