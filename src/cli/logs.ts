import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  watchFile,
  unwatchFile,
} from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../config/env.js";
import { platformDirs } from "../config/platform.js";

/** Return the last `n` lines of `content` (cross-platform; no `tail` needed). */
export function tailLines(content: string, n: number): string {
  if (n <= 0) return "";
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (normalized === "") return "";
  const lines = normalized.split("\n");
  return lines.slice(-n).join("\n");
}

/** Resolve the active log file path (LOG_FILE, else the per-user log dir). */
export function resolveLogFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LOG_FILE?.trim();
  if (configured) return configured;
  return join(platformDirs(env).log, "bridge.log");
}

/** Read bytes [from, size) of a file as UTF-8 text. */
function readFrom(path: string, from: number, size: number): string {
  const length = size - from;
  if (length <= 0) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const read = readSync(fd, buf, 0, length, from);
    return buf.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Print the tail of the bridge log, optionally following new output. Portable
 * across Linux/macOS/Windows — no dependency on a `tail` binary.
 */
export function runLogs(follow: boolean, lines = 200): void {
  loadEnv();
  const file = resolveLogFile();
  if (!existsSync(file)) {
    process.stderr.write(
      `No log file yet at ${file}.\n` +
        "Start the bridge with `slack-claude run` to generate logs.\n",
    );
    process.exitCode = 1;
    return;
  }

  const size = statSync(file).size;
  const initial = readFrom(file, 0, size);
  process.stdout.write(tailLines(initial, lines));
  process.stdout.write("\n");

  if (!follow) return;

  let position = size;
  process.stdout.write(`\n--- following ${file} (Ctrl-C to stop) ---\n`);
  watchFile(file, { interval: 500 }, (curr) => {
    if (curr.size < position) {
      // File was truncated/rotated; restart from the beginning.
      position = 0;
    }
    if (curr.size > position) {
      process.stdout.write(readFrom(file, position, curr.size));
      position = curr.size;
    }
  });
  const stop = () => {
    unwatchFile(file);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
