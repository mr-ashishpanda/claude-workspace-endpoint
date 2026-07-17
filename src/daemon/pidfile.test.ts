import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pidFilePath, readRunningPid, writePidFile, removePidFile } from "./pidfile.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scb-pidfile-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("pidfile", () => {
  it("reports no pid when no pidfile exists", () => {
    expect(readRunningPid(home)).toBeNull();
  });

  it("round-trips a live pid (this test process)", () => {
    writePidFile(home, process.pid);
    expect(readRunningPid(home)).toBe(process.pid);
  });

  it("treats a stale pid (process no longer running) as absent and cleans it up", () => {
    // PID unlikely to be in use; if it happens to collide the assertion below
    // would fail loudly rather than silently pass.
    const deadPid = 999999;
    writeFileSync(pidFilePath(home), String(deadPid), "utf8");
    expect(readRunningPid(home)).toBeNull();
    expect(existsSync(pidFilePath(home))).toBe(false);
  });

  it("treats garbage content as absent and cleans it up", () => {
    writeFileSync(pidFilePath(home), "not-a-pid", "utf8");
    expect(readRunningPid(home)).toBeNull();
    expect(existsSync(pidFilePath(home))).toBe(false);
  });

  it("removePidFile is a no-op when nothing exists", () => {
    expect(() => removePidFile(home)).not.toThrow();
  });

  it("removePidFile deletes an existing pidfile", () => {
    writePidFile(home, process.pid);
    removePidFile(home);
    expect(existsSync(pidFilePath(home))).toBe(false);
  });
});
