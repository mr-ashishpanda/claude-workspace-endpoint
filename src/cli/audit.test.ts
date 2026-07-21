import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AuditRecord } from "../config/types.js";
import { auditPartitionPath } from "../config/paths.js";
import {
  filterRecords,
  formatLine,
  toCsvRow,
  CSV_HEADER,
  parseOlderThanDays,
  parseFilterDate,
  runAuditMaintenance,
} from "./audit.js";

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "aud_1",
    ts: "2026-07-21T10:00:00.000Z",
    slackTs: "1",
    durationMs: 5,
    user: "U1",
    userName: "Ann",
    channel: "C1",
    channelName: "#general",
    threadTs: null,
    identity: "auth-investigator",
    workspace: "/w",
    sessionId: "s1",
    sessionRef: null,
    outcome: "success",
    error: null,
    tokens: { input: 100, output: 200 },
    summaryTokens: null,
    summary: "Fixed the login bug in the auth module after investigating token expiry issues.",
    summaryError: null,
    ...over,
  };
}

describe("filterRecords", () => {
  it("filters by user id", () => {
    const records = [rec({ user: "U1" }), rec({ user: "U2" })];
    const result = filterRecords(records, { user: "U1" });
    expect(result).toHaveLength(1);
    expect(result[0]?.user).toBe("U1");
  });

  it("filters by user name", () => {
    const records = [rec({ user: "U1", userName: "Ann" }), rec({ user: "U2", userName: "Bob" })];
    const result = filterRecords(records, { user: "Bob" });
    expect(result).toHaveLength(1);
    expect(result[0]?.user).toBe("U2");
  });

  it("filters by channel id or name", () => {
    const records = [
      rec({ channel: "C1", channelName: "#general" }),
      rec({ channel: "C2", channelName: "#random" }),
    ];
    expect(filterRecords(records, { channel: "C2" })).toHaveLength(1);
    expect(filterRecords(records, { channel: "#general" })).toHaveLength(1);
  });

  it("filters by identity exactly", () => {
    const records = [rec({ identity: "a" }), rec({ identity: "b" })];
    const result = filterRecords(records, { identity: "a" });
    expect(result).toHaveLength(1);
    expect(result[0]?.identity).toBe("a");
  });

  it("filters by since/until range, inclusive of the boundaries", () => {
    const records = [
      rec({ ts: "2026-07-01T00:00:00.000Z" }),
      rec({ ts: "2026-07-05T00:00:00.000Z" }),
      rec({ ts: "2026-07-10T00:00:00.000Z" }),
      rec({ ts: "2026-07-15T00:00:00.000Z" }),
      rec({ ts: "2026-07-20T00:00:00.000Z" }),
    ];
    const result = filterRecords(records, {
      since: new Date("2026-07-05T00:00:00.000Z"),
      until: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(result.map((r) => r.ts)).toEqual([
      "2026-07-05T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z",
      "2026-07-15T00:00:00.000Z",
    ]);
  });

  it("combines multiple filters (AND semantics)", () => {
    const records = [
      rec({ user: "U1", identity: "a" }),
      rec({ user: "U1", identity: "b" }),
      rec({ user: "U2", identity: "a" }),
    ];
    const result = filterRecords(records, { user: "U1", identity: "a" });
    expect(result).toHaveLength(1);
  });

  it("returns all records when no filters are given", () => {
    const records = [rec(), rec()];
    expect(filterRecords(records, {})).toHaveLength(2);
    expect(filterRecords(records)).toHaveLength(2);
  });
});

describe("formatLine", () => {
  it("includes the user name, identity, outcome, and token counts", () => {
    const line = formatLine(rec());
    expect(line).toContain("Ann");
    expect(line).toContain("auth-investigator");
    expect(line).toContain("success");
    expect(line).toContain("100/200 tok");
  });

  it("truncates a long summary to about 80 characters", () => {
    const longSummary =
      "This is a really long summary that goes well beyond eighty characters so it must be truncated for display.";
    const line = formatLine(rec({ summary: longSummary }));
    expect(line).toContain(longSummary.slice(0, 20));
    expect(line).not.toContain("must be truncated for display.");
  });

  it("falls back to the raw user/channel ids when names are absent", () => {
    const line = formatLine(rec({ userName: null, channelName: null, user: "U9", channel: "C9" }));
    expect(line).toContain("U9");
    expect(line).toContain("C9");
  });

  it("shows the error when outcome is error and summary is null", () => {
    const line = formatLine(rec({ outcome: "error", summary: null, error: "workspace not found" }));
    expect(line).toContain("error");
    expect(line).toContain("workspace not found");
  });

  it("shows a placeholder when summary and error are both null", () => {
    const line = formatLine(rec({ summary: null, error: null }));
    expect(line).toContain("(no summary)");
  });
});

describe("toCsvRow / CSV_HEADER", () => {
  it("exposes a stable header with the key columns", () => {
    const cols = CSV_HEADER.split(",");
    expect(cols).toContain("id");
    expect(cols).toContain("ts");
    expect(cols).toContain("outcome");
  });

  it("quotes a field containing a comma", () => {
    const row = toCsvRow(rec({ summary: "fixed bug, and cleaned up" }));
    expect(row).toContain('"fixed bug, and cleaned up"');
  });

  it("escapes embedded quotes by doubling them", () => {
    const row = toCsvRow(rec({ summary: 'said "hello" to the user' }));
    expect(row).toContain('"said ""hello"" to the user"');
  });

  it("quotes a field containing a newline", () => {
    const row = toCsvRow(rec({ summary: "line one\nline two" }));
    expect(row).toContain('"line one\nline two"');
  });

  it("leaves plain fields unquoted", () => {
    const row = toCsvRow(rec({ identity: "auth-investigator" }));
    expect(row).toContain(",auth-investigator,");
  });
});

describe("parseOlderThanDays", () => {
  it("parses a bare number", () => {
    expect(parseOlderThanDays("90")).toBe(90);
  });

  it("parses a number with a trailing d", () => {
    expect(parseOlderThanDays("90d")).toBe(90);
  });

  it("throws on an invalid value", () => {
    expect(() => parseOlderThanDays("abc")).toThrow();
    expect(() => parseOlderThanDays("")).toThrow();
  });
});

describe("parseFilterDate", () => {
  it("parses a valid ISO date", () => {
    const date = parseFilterDate("--since", "2026-07-01");
    expect(date.getTime()).not.toBeNaN();
  });

  it("throws a friendly error on an invalid date", () => {
    expect(() => parseFilterDate("--since", "not-a-date")).toThrow(
      'Invalid --since date: "not-a-date"',
    );
    expect(() => parseFilterDate("--until", "not-a-date")).toThrow(
      'Invalid --until date: "not-a-date"',
    );
  });
});

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "audit-cli-"));
}

/** Write a raw partition file directly (bypassing AuditStore) at the date's path. */
function writePartition(home: string, date: Date): string {
  const path = auditPartitionPath(home, date);
  mkdirSync(dirname(path), { recursive: true });
  const record: AuditRecord = {
    id: "aud_1",
    ts: date.toISOString(),
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
  };
  writeFileSync(path, JSON.stringify(record) + "\n");
  return path;
}

describe("runAuditMaintenance prune", () => {
  const OLD_DATE = new Date("2000-01-01T00:00:00.000Z");
  let previousHome: string | undefined;

  afterEach(() => {
    if (previousHome === undefined) delete process.env.SLACK_CLAUDE_HOME;
    else process.env.SLACK_CLAUDE_HOME = previousHome;
  });

  it("is a no-op without --yes: the old partition still exists", () => {
    const home = tmpHome();
    previousHome = process.env.SLACK_CLAUDE_HOME;
    process.env.SLACK_CLAUDE_HOME = home;

    const oldPath = writePartition(home, OLD_DATE);

    runAuditMaintenance("prune", ["--older-than", "1"]);

    expect(existsSync(oldPath)).toBe(true);
  });

  it("with --yes removes the old partition and writes its month's rollup first", () => {
    const home = tmpHome();
    previousHome = process.env.SLACK_CLAUDE_HOME;
    process.env.SLACK_CLAUDE_HOME = home;

    const oldPath = writePartition(home, OLD_DATE);
    const rollupPath = join(home, "audit", "2000", "01.rollup.json");

    runAuditMaintenance("prune", ["--older-than", "1", "--yes"]);

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(rollupPath)).toBe(true);
  });
});
