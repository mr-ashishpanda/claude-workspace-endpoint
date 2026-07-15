import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tailLines, resolveLogFile } from "./logs.js";

describe("tailLines", () => {
  it("returns the last n lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });

  it("returns everything when n exceeds the line count", () => {
    expect(tailLines("a\nb\n", 10)).toBe("a\nb");
  });

  it("handles content without a trailing newline", () => {
    expect(tailLines("a\nb\nc", 2)).toBe("b\nc");
  });

  it("returns empty for empty content or non-positive n", () => {
    expect(tailLines("", 5)).toBe("");
    expect(tailLines("a\nb\n", 0)).toBe("");
  });
});

describe("resolveLogFile", () => {
  it("prefers an explicit LOG_FILE", () => {
    expect(resolveLogFile({ LOG_FILE: "/var/log/bridge.log" })).toBe("/var/log/bridge.log");
  });

  it("falls back to the per-user log dir", () => {
    const path = resolveLogFile({ XDG_STATE_HOME: "/state" });
    expect(path).toBe(join("/state", "slack-claude", "logs", "bridge.log"));
  });
});
