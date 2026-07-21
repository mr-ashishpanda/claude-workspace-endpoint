import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditStore } from "./partition.js";
import { AuditRecord } from "../config/types.js";
import { auditPartitionPath } from "../config/paths.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "audit-part-"));
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

it("appends to the day partition and reads it back", () => {
  const home = tmp();
  const store = new AuditStore(home);
  store.append(rec({ id: "a", ts: "2026-07-21T10:00:00.000Z" }));
  store.append(rec({ id: "b", ts: "2026-07-21T11:00:00.000Z" }));
  const all = store.read();
  expect(all.map((r) => r.id)).toEqual(["a", "b"]);
});

it("skips malformed lines", async () => {
  const home = tmp();
  const store = new AuditStore(home);
  store.append(rec({ id: "good", ts: "2026-07-21T10:00:00.000Z" }));
  // Corrupt the partition by appending junk directly.
  const { appendFileSync } = await import("node:fs");
  appendFileSync(auditPartitionPath(home, new Date("2026-07-21T10:00:00Z")), "{ broken\n");
  expect(store.read().map((r) => r.id)).toEqual(["good"]);
});

it("filters by since/until across days and reads gzipped partitions", async () => {
  const home = tmp();
  // append() partitions by the store's clock (the "current day's" partition per the
  // audit-trail design), not by the record's own `ts` — inject each historical date
  // explicitly so "jun" and "jul" land in distinct day partitions.
  new AuditStore(home, () => new Date("2026-06-30T10:00:00.000Z")).append(
    rec({ id: "jun", ts: "2026-06-30T10:00:00.000Z" }),
  );
  new AuditStore(home, () => new Date("2026-07-21T10:00:00.000Z")).append(
    rec({ id: "jul", ts: "2026-07-21T10:00:00.000Z" }),
  );
  const store = new AuditStore(home);
  // gzip the June partition in place, then confirm it's still read.
  const { readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { gzipSync } = await import("node:zlib");
  const junPath = auditPartitionPath(home, new Date("2026-06-30T10:00:00Z"));
  writeFileSync(junPath + ".gz", gzipSync(readFileSync(junPath)));
  rmSync(junPath);
  expect(
    store
      .read()
      .map((r) => r.id)
      .sort(),
  ).toEqual(["jul", "jun"]);
  expect(store.read({ since: new Date("2026-07-01T00:00:00Z") }).map((r) => r.id)).toEqual(["jul"]);
});
