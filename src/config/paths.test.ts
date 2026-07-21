import { describe, it, expect } from "vitest";
import { isAbsolute, join, resolve } from "node:path";
import {
  resolveHome,
  mappingsPath,
  sessionsPath,
  mediaDir,
  auditDir,
  auditConfigPath,
  auditPartitionPath,
} from "./paths.js";

describe("resolveHome", () => {
  it("defaults to an absolute per-user data directory", () => {
    const home = resolveHome({});
    expect(isAbsolute(home)).toBe(true);
    expect(home.endsWith("slack-claude")).toBe(true);
  });

  it("honors SLACK_CLAUDE_HOME and resolves it to absolute", () => {
    const home = resolveHome({ SLACK_CLAUDE_HOME: "/var/lib/scb" });
    expect(home).toBe("/var/lib/scb");
  });

  it("ignores a blank override, falling back to the per-user data directory", () => {
    expect(resolveHome({ SLACK_CLAUDE_HOME: "   " }).endsWith("slack-claude")).toBe(true);
  });
});

describe("mappingsPath / sessionsPath", () => {
  it("place files inside the home directory", () => {
    expect(mappingsPath("/home/x")).toBe(join("/home/x", "mappings.json"));
    expect(sessionsPath("/home/x")).toBe(join("/home/x", "sessions.json"));
  });
});

describe("mediaDir", () => {
  it("places downloaded media under <home>/media", () => {
    expect(mediaDir("/home/x")).toBe(join("/home/x", "media"));
  });
});

describe("audit paths", () => {
  it("derives audit dir and config path under home", () => {
    expect(auditDir("/home")).toBe(resolve("/home", "audit"));
    expect(auditConfigPath("/home")).toBe(resolve("/home", "audit-config.json"));
  });
  it("partitions by UTC year/month/day", () => {
    const d = new Date("2026-07-21T23:30:00.000Z");
    expect(auditPartitionPath("/home", d)).toBe(
      resolve("/home", "audit", "2026", "07", "2026-07-21.jsonl"),
    );
  });
});
