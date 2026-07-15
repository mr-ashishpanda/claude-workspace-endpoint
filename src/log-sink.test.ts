import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RotatingFileSink,
  parseByteLimit,
  DEFAULT_LOG_MAX_SIZE,
  DEFAULT_LOG_MAX_FILES,
} from "./log-sink.js";

describe("parseByteLimit", () => {
  it("falls back on undefined/blank/invalid", () => {
    expect(parseByteLimit(undefined, 42)).toBe(42);
    expect(parseByteLimit("   ", 42)).toBe(42);
    expect(parseByteLimit("nope", 42)).toBe(42);
    expect(parseByteLimit("-5", 42)).toBe(42);
  });

  it("parses non-negative integers, including 0", () => {
    expect(parseByteLimit("0", 42)).toBe(0);
    expect(parseByteLimit("1048576", 42)).toBe(1048576);
    expect(parseByteLimit("100.9", 42)).toBe(100);
  });
});

describe("RotatingFileSink", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "log-sink-"));
    file = join(dir, "bridge.log");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes lines to the live file without rotating under the limit", () => {
    const sink = new RotatingFileSink(file, 10_000, 3);
    sink.append("one");
    sink.append("two");
    expect(readFileSync(file, "utf8")).toBe("one\ntwo\n");
    expect(existsSync(`${file}.1`)).toBe(false);
  });

  it("rotates when the size limit is exceeded and caps the archive count", () => {
    // Each line is 10 bytes ("123456789\n"); limit 25 => rotate every ~2-3 lines.
    const sink = new RotatingFileSink(file, 25, 2);
    for (let i = 0; i < 20; i++) sink.append("123456789");

    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    // maxFiles = 2 => never a third archive.
    expect(existsSync(`${file}.3`)).toBe(false);

    // Total retained history stays bounded (< maxSize * (maxFiles + 1) + a line).
    const total = [file, `${file}.1`, `${file}.2`]
      .filter(existsSync)
      .reduce((sum, f) => sum + statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(25 * 3 + 10);
  });

  it("preserves the most recent lines in the live file after rotation", () => {
    const sink = new RotatingFileSink(file, 25, 3);
    for (let i = 0; i < 10; i++) sink.append(`line-${i}`);
    // The very last line must be in the live file.
    expect(readFileSync(file, "utf8")).toContain("line-9");
  });

  it("seeds its byte counter from an existing file so it rotates promptly", () => {
    const first = new RotatingFileSink(file, 25, 2);
    first.append("123456789");
    first.append("123456789"); // file now ~20 bytes, near the 25 limit
    // A fresh sink (e.g. after restart) must not lose track of the size.
    const second = new RotatingFileSink(file, 25, 2);
    second.append("123456789"); // pushes past 25 => rotation
    expect(existsSync(`${file}.1`)).toBe(true);
  });

  it("with maxFiles=0 discards history instead of keeping archives", () => {
    const sink = new RotatingFileSink(file, 25, 0);
    for (let i = 0; i < 20; i++) sink.append("123456789");
    expect(existsSync(`${file}.1`)).toBe(false);
    expect(statSync(file).size).toBeLessThanOrEqual(25 + 10);
  });

  it("with maxSize=0 never rotates", () => {
    const sink = new RotatingFileSink(file, 0, 3);
    for (let i = 0; i < 50; i++) sink.append("123456789");
    expect(existsSync(`${file}.1`)).toBe(false);
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_LOG_MAX_SIZE).toBe(5 * 1024 * 1024);
    expect(DEFAULT_LOG_MAX_FILES).toBe(5);
  });
});
