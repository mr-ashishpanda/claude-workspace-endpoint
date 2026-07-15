import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Default size (bytes) a log file may reach before it is rotated: 5 MiB. */
export const DEFAULT_LOG_MAX_SIZE = 5 * 1024 * 1024;
/** Default number of rotated archives kept alongside the live log file. */
export const DEFAULT_LOG_MAX_FILES = 5;

/** Parse a non-negative integer env value, falling back when absent/invalid. */
export function parseByteLimit(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Append-only log file with size-based rotation. When appending a line would
 * push the live file past `maxSize`, the file is rotated: the oldest archive
 * (`<file>.<maxFiles>`) is dropped, each `<file>.N` shifts to `<file>.N+1`, and
 * the live file becomes `<file>.1`. Keeps at most `maxFiles` archives plus the
 * live file, so total on-disk history is bounded at ~`maxSize * (maxFiles + 1)`.
 *
 * Rotation and writes are best-effort: any filesystem error is swallowed so
 * logging can never crash the bridge. A byte counter is tracked in memory
 * (seeded from the existing file) to avoid a stat() on every line.
 */
export class RotatingFileSink {
  private size: number;

  constructor(
    private readonly file: string,
    private readonly maxSize: number = DEFAULT_LOG_MAX_SIZE,
    private readonly maxFiles: number = DEFAULT_LOG_MAX_FILES,
  ) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      // Best effort; append() will no-op if the file can't be written.
    }
    this.size = this.currentSize();
  }

  private currentSize(): number {
    try {
      return statSync(this.file).size;
    } catch {
      return 0;
    }
  }

  /** Append one line (a trailing newline is added), rotating first if needed. */
  append(line: string): void {
    const payload = line + "\n";
    const bytes = Buffer.byteLength(payload);
    try {
      if (this.maxSize > 0 && this.size > 0 && this.size + bytes > this.maxSize) {
        this.rotate();
        this.size = 0;
      }
      appendFileSync(this.file, payload);
      this.size += bytes;
    } catch {
      // Never let logging crash the bridge.
    }
  }

  private rotate(): void {
    if (this.maxFiles <= 0) {
      // No archives requested: discard the live file and start fresh.
      try {
        rmSync(this.file, { force: true });
      } catch {
        /* ignore */
      }
      return;
    }
    // Drop the oldest archive, then shift each archive up by one.
    try {
      rmSync(`${this.file}.${this.maxFiles}`, { force: true });
    } catch {
      /* ignore */
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      try {
        renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
      } catch {
        // Source archive may not exist yet — expected, skip.
      }
    }
    try {
      renameSync(this.file, `${this.file}.1`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Process-wide registry of sinks keyed by resolved file path, so every
 * identity-scoped logger writing the same file shares one byte counter and
 * rotation stays consistent. The first caller's limits win for a given path.
 */
const sinks = new Map<string, RotatingFileSink>();

export function getFileSink(file: string, maxSize: number, maxFiles: number): RotatingFileSink {
  let sink = sinks.get(file);
  if (!sink) {
    sink = new RotatingFileSink(file, maxSize, maxFiles);
    sinks.set(file, sink);
  }
  return sink;
}
