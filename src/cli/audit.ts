import { AuditStore } from "../audit/partition.js";
import { compact, prune, rollup } from "../audit/maintenance.js";
import { AuditConfigStore } from "../config/audit-config.js";
import { resolveHome } from "../config/paths.js";
import { AuditRecord } from "../config/types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SUMMARY_TRUNCATE_LEN = 80;

/** Filter options for the `audit` query command. All conditions are AND'd. */
export interface AuditFilterOptions {
  user?: string;
  channel?: string;
  identity?: string;
  since?: Date;
  until?: Date;
}

/**
 * Filter audit records: `user` matches against `record.user` OR `record.userName`;
 * `channel` matches against `record.channel` OR `record.channelName`; `identity`
 * is an exact match; `since`/`until` bound `record.ts` inclusively.
 */
export function filterRecords(
  records: AuditRecord[],
  opts: AuditFilterOptions = {},
): AuditRecord[] {
  return records.filter((r) => {
    if (opts.user && r.user !== opts.user && r.userName !== opts.user) return false;
    if (opts.channel && r.channel !== opts.channel && r.channelName !== opts.channel) return false;
    if (opts.identity && r.identity !== opts.identity) return false;
    const ts = Date.parse(r.ts);
    if (opts.since && ts < opts.since.getTime()) return false;
    if (opts.until && ts > opts.until.getTime()) return false;
    return true;
  });
}

/** Truncate `text` to about `SUMMARY_TRUNCATE_LEN` characters, with an ellipsis if cut. */
function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_TRUNCATE_LEN) return text;
  return text.slice(0, SUMMARY_TRUNCATE_LEN - 3) + "...";
}

/**
 * One-liner for a single audit record, suitable for the default `audit` command
 * output: `<ts> · <who> · <identity> · <where> · <outcome> · <in>/<out> tok · "<summary>"`.
 */
export function formatLine(r: AuditRecord): string {
  const who = r.userName ?? r.user ?? "(unknown user)";
  const where = r.channelName ?? r.channel;
  const tokens = `${r.tokens.input}/${r.tokens.output} tok`;
  const body = r.summary ?? (r.outcome === "error" ? (r.error ?? "(no summary)") : "(no summary)");
  return `${r.ts} · ${who} · ${r.identity} · ${where} · ${r.outcome} · ${tokens} · "${truncateSummary(body)}"`;
}

/** CSV header matching the field order produced by {@link toCsvRow}. */
export const CSV_HEADER =
  "id,ts,user,userName,channel,channelName,identity,outcome,tokensIn,tokensOut,summary,error";

/** Wrap `field` in quotes (doubling embedded quotes) if it needs CSV escaping. */
function csvEscape(field: string): string {
  if (/[",\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** Serialize one audit record as a CSV row matching {@link CSV_HEADER}. */
export function toCsvRow(r: AuditRecord): string {
  return [
    r.id,
    r.ts,
    r.user ?? "",
    r.userName ?? "",
    r.channel,
    r.channelName ?? "",
    r.identity,
    r.outcome,
    String(r.tokens.input),
    String(r.tokens.output),
    r.summary ?? "",
    r.error ?? "",
  ]
    .map(csvEscape)
    .join(",");
}

/** Parse a `--older-than` value: accepts either `"90"` or `"90d"`. */
export function parseOlderThanDays(value: string): number {
  const match = /^(\d+)d?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid --older-than value "${value}"; expected e.g. "90" or "90d"`);
  }
  return Number(match[1]);
}

interface AuditQueryFlags {
  user?: string;
  channel?: string;
  identity?: string;
  since?: Date;
  until?: Date;
  json: boolean;
  csv: boolean;
}

function parseAuditQueryArgs(args: string[]): AuditQueryFlags {
  const flags: AuditQueryFlags = { json: false, csv: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--user":
        flags.user = args[++i];
        break;
      case "--channel":
        flags.channel = args[++i];
        break;
      case "--identity":
        flags.identity = args[++i];
        break;
      case "--since": {
        const raw = args[++i];
        if (raw) flags.since = new Date(raw);
        break;
      }
      case "--until": {
        const raw = args[++i];
        if (raw) flags.until = new Date(raw);
        break;
      }
      case "--json":
        flags.json = true;
        break;
      case "--csv":
        flags.csv = true;
        break;
      default:
        break;
    }
  }
  return flags;
}

/**
 * `slack-claude audit`: read-only query over the local audit trail. Prints a
 * human-readable one-liner per record by default, or `--json`/`--csv` for export.
 */
export function runAudit(args: string[]): void {
  const flags = parseAuditQueryArgs(args);
  const home = resolveHome();
  const all = new AuditStore(home).read({ since: flags.since, until: flags.until });
  const records = filterRecords(all, {
    user: flags.user,
    channel: flags.channel,
    identity: flags.identity,
    since: flags.since,
    until: flags.until,
  });

  if (records.length === 0) {
    process.stdout.write("No audit records match the given filters.\n");
    return;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
    return;
  }
  if (flags.csv) {
    process.stdout.write([CSV_HEADER, ...records.map(toCsvRow)].join("\n") + "\n");
    return;
  }
  process.stdout.write(records.map(formatLine).join("\n") + "\n");
}

/** Find a `--flag value` pair in `args`; returns undefined if the flag is absent. */
function findFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/** Distinct `YYYY-MM` (UTC) months represented among `records`. */
function distinctMonths(records: AuditRecord[]): string[] {
  const months = new Set<string>();
  for (const r of records) {
    const d = new Date(r.ts);
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    months.add(`${y}-${m}`);
  }
  return [...months].sort();
}

function runCompact(home: string, args: string[]): void {
  const raw = findFlagValue(args, "--older-than");
  const days = raw
    ? parseOlderThanDays(raw)
    : AuditConfigStore.load(home).get().retention.compactAfterDays;
  const compacted = compact(home, days);
  process.stdout.write(
    compacted.length === 0
      ? `No partitions older than ${days}d to compact.\n`
      : `Compacted ${compacted.length} partition(s) older than ${days}d.\n`,
  );
}

function runRollup(home: string, args: string[]): void {
  const month = findFlagValue(args, "--month");
  if (!month) {
    process.stderr.write("Usage: slack-claude audit rollup --month YYYY-MM\n");
    process.exitCode = 1;
    return;
  }
  const path = rollup(home, month);
  process.stdout.write(`Wrote rollup to ${path}\n`);
}

function runPrune(home: string, args: string[]): void {
  const raw = findFlagValue(args, "--older-than");
  const days = raw
    ? parseOlderThanDays(raw)
    : AuditConfigStore.load(home).get().retention.pruneAfterDays;
  const yes = args.includes("--yes");

  const cutoff = new Date(Date.now() - days * MS_PER_DAY);
  const wouldRemove = new AuditStore(home).read({ until: cutoff });

  if (!yes) {
    process.stdout.write(
      wouldRemove.length === 0
        ? `No audit records older than ${days}d to prune.\n`
        : `Would prune ${wouldRemove.length} audit record(s) older than ${days}d. ` +
            "Re-run with --yes to actually delete (monthly rollups are written first).\n",
    );
    return;
  }

  for (const month of distinctMonths(wouldRemove)) {
    rollup(home, month);
  }
  const removed = prune(home, days);
  process.stdout.write(`Removed ${removed.length} partition(s) older than ${days}d.\n`);
}

/**
 * `slack-claude audit compact|rollup|prune`: explicit retention maintenance.
 * `prune` requires `--yes`; without it, it prints what would be removed and
 * makes no changes. Before deleting, `prune` rolls up every affected month so
 * long-term aggregates survive.
 */
export function runAuditMaintenance(sub: "compact" | "rollup" | "prune", args: string[]): void {
  const home = resolveHome();
  if (sub === "compact") runCompact(home, args);
  else if (sub === "rollup") runRollup(home, args);
  else runPrune(home, args);
}
