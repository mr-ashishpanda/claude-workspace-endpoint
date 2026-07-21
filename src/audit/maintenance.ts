import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { AuditRecord } from "../config/types.js";
import { auditDir } from "../config/paths.js";
import { AuditStore } from "./partition.js";

const PARTITION_RE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl(\.gz)?$/;

interface PartitionEntry {
  /** Absolute path to the partition file. */
  path: string;
  /** UTC midnight of the date encoded in the filename. */
  date: Date;
  /** Whether this partition is already gzipped (`.jsonl.gz`). */
  gz: boolean;
}

/** Enumerate raw day-partition files (`.jsonl` / `.jsonl.gz`) under `audit/`, with parsed dates. */
function enumeratePartitions(home: string): PartitionEntry[] {
  const root = auditDir(home);
  if (!existsSync(root)) return [];
  const out: PartitionEntry[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const match = PARTITION_RE.exec(entry.name);
      if (!match) continue;
      const [, y, m, d, gzExt] = match;
      out.push({
        path: full,
        date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))),
        gz: Boolean(gzExt),
      });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Instant before which a partition counts as eligible for compaction/pruning. */
function cutoffDate(olderThanDays: number, now: () => Date): Date {
  return new Date(now().getTime() - olderThanDays * 24 * 60 * 60 * 1000);
}

/**
 * Gzip every raw `.jsonl` partition whose date is strictly older than
 * `now() - olderThanDays`, then delete the original. Already-gzipped partitions
 * are left alone. Returns the original paths that were compacted.
 */
export function compact(
  home: string,
  olderThanDays: number,
  now: () => Date = () => new Date(),
): string[] {
  const cutoff = cutoffDate(olderThanDays, now);
  const compacted: string[] = [];
  for (const entry of enumeratePartitions(home)) {
    if (entry.gz) continue;
    if (entry.date.getTime() >= cutoff.getTime()) continue;
    writeFileSync(entry.path + ".gz", gzipSync(readFileSync(entry.path)));
    rmSync(entry.path);
    compacted.push(entry.path);
  }
  return compacted;
}

/**
 * Raw partition file paths (`.jsonl` and `.jsonl.gz`) strictly older than
 * `now() - olderThanDays`. This is the single source of truth for "which
 * partitions are old enough to prune" — `prune` deletes exactly this set, and
 * callers (e.g. the CLI) can use it to compute which months to roll up before
 * pruning, and what would be removed in a dry run, without the two ever
 * disagreeing. Never includes `*.rollup.json`.
 */
export function partitionsToPrune(
  home: string,
  olderThanDays: number,
  now: () => Date = () => new Date(),
): string[] {
  const cutoff = cutoffDate(olderThanDays, now);
  return enumeratePartitions(home)
    .filter((entry) => entry.date.getTime() < cutoff.getTime())
    .map((entry) => entry.path);
}

/**
 * Delete every raw partition (`.jsonl` and `.jsonl.gz`) whose date is strictly
 * older than `now() - olderThanDays`. Never touches `*.rollup.json`. Returns
 * the removed paths.
 */
export function prune(
  home: string,
  olderThanDays: number,
  now: () => Date = () => new Date(),
): string[] {
  const removed: string[] = [];
  for (const path of partitionsToPrune(home, olderThanDays, now)) {
    rmSync(path);
    removed.push(path);
  }
  return removed;
}

interface RollupBucket {
  count: number;
  input: number;
  output: number;
}

/** Monthly aggregate written by `rollup`. */
export interface AuditRollup {
  month: string;
  byUser: Record<string, RollupBucket>;
  byChannel: Record<string, RollupBucket>;
  firstTs: string | null;
  lastTs: string | null;
}

/** Parsed `"YYYY-MM"` month string: numeric parts plus the original zero-padded strings. */
function parseMonth(month: string): {
  year: number;
  monthNum: number;
  yearStr: string;
  monthStr: string;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Invalid month "${month}", expected "YYYY-MM"`);
  const yearStr = match[1] as string;
  const monthStr = match[2] as string;
  return { year: Number(yearStr), monthNum: Number(monthStr), yearStr, monthStr };
}

/** UTC [since, until] instants spanning the given `YYYY-MM` month, inclusive. */
function monthRange(month: string): { since: Date; until: Date } {
  const { year, monthNum } = parseMonth(month);
  const since = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
  const until = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0) - 1);
  return { since, until };
}

function bump(bucket: Record<string, RollupBucket>, key: string, record: AuditRecord): void {
  const entry = bucket[key] ?? { count: 0, input: 0, output: 0 };
  entry.count += 1;
  entry.input += record.tokens.input;
  entry.output += record.tokens.output;
  bucket[key] = entry;
}

/** Path to the monthly rollup file, `audit/YYYY/MM.rollup.json`, for a given `YYYY-MM` month. */
export function rollupPath(home: string, month: string): string {
  const { yearStr, monthStr } = parseMonth(month);
  return resolve(auditDir(home), yearStr, `${monthStr}.rollup.json`);
}

/**
 * Read all records for `month` (across hot `.jsonl` and warm `.jsonl.gz`
 * partitions) and write the aggregate to `audit/YYYY/MM.rollup.json`. Always
 * overwrites — this is the explicit `audit rollup --month` refresh path.
 * Returns the file path written.
 */
export function rollup(home: string, month: string): string {
  const { since, until } = monthRange(month);
  const records = new AuditStore(home).read({ since, until });

  const byUser: Record<string, RollupBucket> = {};
  const byChannel: Record<string, RollupBucket> = {};
  for (const record of records) {
    if (record.user) bump(byUser, record.user, record);
    bump(byChannel, record.channel, record);
  }

  const result: AuditRollup = {
    month,
    byUser,
    byChannel,
    firstTs: records.length > 0 ? (records[0] as AuditRecord).ts : null,
    lastTs: records.length > 0 ? (records[records.length - 1] as AuditRecord).ts : null,
  };

  const path = rollupPath(home, month);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  return path;
}

/** Distinct `YYYY-MM` months among a set of partition paths (basenames `YYYY-MM-DD.jsonl[.gz]`). */
function distinctMonthsOfPartitions(paths: string[]): string[] {
  const months = new Set<string>();
  for (const path of paths) {
    const match = PARTITION_RE.exec(path.split(/[/\\]/).pop() ?? "");
    if (match) months.add(`${match[1]}-${match[2]}`);
  }
  return [...months].sort();
}

/**
 * Roll up every month affected by an upcoming prune, then prune. Once a month
 * already has a rollup file, it is NOT regenerated here — the first prune run
 * that ever touches a past month always sees the whole month (no new records
 * land in a past month), so that first rollup is complete. A later prune run
 * only sees the surviving (partial) subset of that month's partitions, and
 * regenerating from it would clobber the complete aggregate with a partial
 * one. Skipping regeneration when a rollup already exists preserves the
 * complete aggregate across repeated prune runs.
 *
 * `rollup()` itself always overwrites — that's the explicit `audit rollup
 * --month` refresh path — this skip-if-exists guard lives only here.
 */
export function pruneWithRollups(
  home: string,
  olderThanDays: number,
  now: () => Date = () => new Date(),
): { rolledUp: string[]; removed: string[] } {
  const targets = partitionsToPrune(home, olderThanDays, now);
  const months = distinctMonthsOfPartitions(targets);

  const rolledUp: string[] = [];
  for (const month of months) {
    if (existsSync(rollupPath(home, month))) continue;
    rollup(home, month);
    rolledUp.push(month);
  }

  const removed = prune(home, olderThanDays, now);
  return { rolledUp, removed };
}
