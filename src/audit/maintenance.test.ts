import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { compact, prune, pruneWithRollups, rollup, rollupPath } from "./maintenance.js";
import { AuditRecord } from "../config/types.js";
import { auditDir, auditPartitionPath } from "../config/paths.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "audit-maint-"));
}

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "aud_1",
    ts: "2026-07-21T10:00:00.000Z",
    slackTs: "1",
    durationMs: 5,
    user: "U1",
    userName: "Ann",
    channel: "C1",
    channelName: "#c",
    threadTs: null,
    identity: "id1",
    workspace: "/w",
    sessionId: "s1",
    sessionRef: null,
    outcome: "success",
    error: null,
    tokens: { input: 1, output: 2 },
    summaryTokens: null,
    summary: null,
    summaryError: null,
    ...over,
  };
}

/** Write a partition file directly (bypassing AuditStore) at the date's path. */
function writePartition(home: string, date: Date, records: AuditRecord[]): string {
  const path = auditPartitionPath(home, date);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

function gzipInPlace(path: string): string {
  writeFileSync(path + ".gz", gzipSync(readFileSync(path)));
  rmSync(path);
  return path + ".gz";
}

describe("compact", () => {
  it("gzips only partitions older than the cutoff, removes the originals, and leaves newer ones", () => {
    const home = tmp();
    const now = () => new Date("2026-07-21T00:00:00.000Z");
    const oldPath = writePartition(home, new Date("2026-04-01T00:00:00Z"), [
      rec({ id: "old", ts: "2026-04-01T00:00:00.000Z" }),
    ]);
    const newPath = writePartition(home, new Date("2026-07-20T00:00:00Z"), [
      rec({ id: "new", ts: "2026-07-20T00:00:00.000Z" }),
    ]);

    const result = compact(home, 90, now);

    expect(result).toEqual([oldPath]);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(oldPath + ".gz")).toBe(true);
    expect(gunzipSync(readFileSync(oldPath + ".gz")).toString("utf8")).toContain('"id":"old"');
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(newPath + ".gz")).toBe(false);
  });

  it("does not compact a partition exactly at the cutoff (strictly older only)", () => {
    const home = tmp();
    const now = () => new Date("2026-07-21T00:00:00.000Z");
    // cutoff = now - 10 days = 2026-07-11T00:00:00Z, exactly this partition's date.
    const atCutoff = writePartition(home, new Date("2026-07-11T00:00:00Z"), [
      rec({ id: "at-cutoff", ts: "2026-07-11T00:00:00.000Z" }),
    ]);

    const result = compact(home, 10, now);

    expect(result).toEqual([]);
    expect(existsSync(atCutoff)).toBe(true);
  });

  it("skips a partition that is already .jsonl.gz", () => {
    const home = tmp();
    const now = () => new Date("2026-07-21T00:00:00.000Z");
    const jsonlPath = writePartition(home, new Date("2026-01-01T00:00:00Z"), [
      rec({ id: "already", ts: "2026-01-01T00:00:00.000Z" }),
    ]);
    const gzPath = gzipInPlace(jsonlPath);

    const result = compact(home, 90, now);

    expect(result).toEqual([]);
    expect(existsSync(gzPath)).toBe(true);
  });
});

describe("rollup", () => {
  it("aggregates per-user/per-channel counts and token totals across .jsonl and .jsonl.gz partitions", () => {
    const home = tmp();
    writePartition(home, new Date("2026-07-05T00:00:00Z"), [
      rec({
        id: "a",
        ts: "2026-07-05T09:00:00.000Z",
        user: "U1",
        channel: "C1",
        tokens: { input: 10, output: 20 },
      }),
      rec({
        id: "b",
        ts: "2026-07-05T10:00:00.000Z",
        user: "U2",
        channel: "C1",
        tokens: { input: 5, output: 5 },
      }),
    ]);
    const day2 = writePartition(home, new Date("2026-07-15T00:00:00Z"), [
      rec({
        id: "c",
        ts: "2026-07-15T12:00:00.000Z",
        user: "U1",
        channel: "C2",
        tokens: { input: 3, output: 7 },
      }),
      rec({
        id: "d",
        ts: "2026-07-15T13:00:00.000Z",
        user: null,
        channel: "C2",
        tokens: { input: 1, output: 1 },
      }),
    ]);
    gzipInPlace(day2);
    // Outside the target month — must be excluded from the aggregate.
    writePartition(home, new Date("2026-06-30T00:00:00Z"), [
      rec({
        id: "june",
        ts: "2026-06-30T10:00:00.000Z",
        user: "U1",
        channel: "C1",
        tokens: { input: 100, output: 100 },
      }),
    ]);

    const path = rollup(home, "2026-07");

    expect(path).toBe(join(auditDir(home), "2026", "07.rollup.json"));
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      month: string;
      byUser: Record<string, { count: number; input: number; output: number }>;
      byChannel: Record<string, { count: number; input: number; output: number }>;
      firstTs: string | null;
      lastTs: string | null;
    };
    expect(written.month).toBe("2026-07");
    expect(written.byUser).toEqual({
      U1: { count: 2, input: 13, output: 27 },
      U2: { count: 1, input: 5, output: 5 },
    });
    expect(written.byChannel).toEqual({
      C1: { count: 2, input: 15, output: 25 },
      C2: { count: 2, input: 4, output: 8 },
    });
    expect(written.firstTs).toBe("2026-07-05T09:00:00.000Z");
    expect(written.lastTs).toBe("2026-07-15T13:00:00.000Z");
  });

  it("writes null firstTs/lastTs and empty buckets for a month with no records", () => {
    const home = tmp();
    const path = rollup(home, "2026-08");
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      byUser: Record<string, unknown>;
      byChannel: Record<string, unknown>;
      firstTs: string | null;
      lastTs: string | null;
    };
    expect(written.byUser).toEqual({});
    expect(written.byChannel).toEqual({});
    expect(written.firstTs).toBeNull();
    expect(written.lastTs).toBeNull();
  });
});

describe("prune", () => {
  it("removes only .jsonl/.jsonl.gz partitions older than the cutoff and never touches .rollup.json", () => {
    const home = tmp();
    const now = () => new Date("2026-07-21T00:00:00.000Z");
    const oldJsonl = writePartition(home, new Date("2026-01-01T00:00:00Z"), [
      rec({ id: "old1", ts: "2026-01-01T00:00:00.000Z" }),
    ]);
    const oldGzSource = writePartition(home, new Date("2026-02-01T00:00:00Z"), [
      rec({ id: "old2", ts: "2026-02-01T00:00:00.000Z" }),
    ]);
    const oldGz = gzipInPlace(oldGzSource);
    const newPath = writePartition(home, new Date("2026-07-20T00:00:00Z"), [
      rec({ id: "new", ts: "2026-07-20T00:00:00.000Z" }),
    ]);
    const rollupPath = rollup(home, "2026-01");

    const removed = prune(home, 90, now);

    expect(removed.slice().sort()).toEqual([oldGz, oldJsonl].sort());
    expect(existsSync(oldJsonl)).toBe(false);
    expect(existsSync(oldGz)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(rollupPath)).toBe(true);
  });
});

describe("pruneWithRollups", () => {
  it("preserves a month's complete rollup across two prune runs that each see only part of the month", () => {
    const home = tmp();
    // Same past month (2026-05), two day-partitions with records for the same
    // user, spread far enough apart that a single prune cutoff can straddle
    // them: one run prunes only the older day, a later run prunes the newer one.
    const day1 = writePartition(home, new Date("2026-05-01T00:00:00Z"), [
      rec({
        id: "d1",
        ts: "2026-05-01T09:00:00.000Z",
        user: "U1",
        channel: "C1",
        tokens: { input: 10, output: 20 },
      }),
    ]);
    const day2 = writePartition(home, new Date("2026-05-20T00:00:00Z"), [
      rec({
        id: "d2",
        ts: "2026-05-20T09:00:00.000Z",
        user: "U1",
        channel: "C1",
        tokens: { input: 3, output: 7 },
      }),
    ]);
    const rollupFile = rollupPath(home, "2026-05");

    // Run A: cutoff (2026-05-05) falls strictly between the two days, so only
    // day1 is pruned. Both partitions still exist when rollup() runs, so the
    // rollup it writes is the COMPLETE month.
    const nowA = () => new Date("2026-05-15T00:00:00.000Z");
    const resultA = pruneWithRollups(home, 10, nowA);
    expect(resultA.rolledUp).toEqual(["2026-05"]);
    expect(resultA.removed).toEqual([day1]);
    expect(existsSync(day1)).toBe(false);
    expect(existsSync(day2)).toBe(true);

    const afterA = JSON.parse(readFileSync(rollupFile, "utf8")) as {
      byUser: Record<string, { count: number; input: number; output: number }>;
    };
    expect(afterA.byUser.U1).toEqual({ count: 2, input: 13, output: 27 });

    // Run B (weeks later): cutoff (2026-06-05) is now past day2 too, so day2
    // gets pruned in this run. The month already has a rollup from run A, so
    // pruneWithRollups must SKIP regenerating it here — day1 is already gone
    // by this point, so if rollup() ran again it would see only day2's record
    // (count 1, input 3, output 7) and clobber the complete aggregate from
    // run A down to that partial one.
    const nowB = () => new Date("2026-06-15T00:00:00.000Z");
    const resultB = pruneWithRollups(home, 10, nowB);
    expect(resultB.rolledUp).toEqual([]);
    expect(resultB.removed).toEqual([day2]);
    expect(existsSync(day2)).toBe(false);

    const afterB = JSON.parse(readFileSync(rollupFile, "utf8")) as {
      byUser: Record<string, { count: number; input: number; output: number }>;
    };
    // Still the complete aggregate from run A — not clobbered to the partial
    // one that a naive "rollup every affected month" would have produced.
    expect(afterB.byUser.U1).toEqual({ count: 2, input: 13, output: 27 });
  });
});
