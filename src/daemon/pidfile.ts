import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Path to the bridge's pidfile inside a given storage home. */
export function pidFilePath(home: string): string {
  return join(home, "bridge.pid");
}

/**
 * The pid of a running bridge for this home, or null if none is running.
 * A pidfile left behind by a process that no longer exists (crash, kill -9,
 * reboot without cleanup) is treated as stale and removed.
 */
export function readRunningPid(home: string): number | null {
  const file = pidFilePath(home);
  if (!existsSync(file)) return null;

  const pid = Number(readFileSync(file, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    unlinkSync(file);
    return null;
  }

  try {
    // Signal 0 sends nothing; it only checks the pid is alive and ours to signal.
    process.kill(pid, 0);
    return pid;
  } catch {
    unlinkSync(file);
    return null;
  }
}

export function writePidFile(home: string, pid: number): void {
  writeFileSync(pidFilePath(home), `${pid}\n`, "utf8");
}

export function removePidFile(home: string): void {
  const file = pidFilePath(home);
  if (existsSync(file)) unlinkSync(file);
}
