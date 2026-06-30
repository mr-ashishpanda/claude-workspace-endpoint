import { describe, it, expect } from "vitest";
import { formatStatus, formatUtc, withIdentity } from "./status.js";
import { Mapping, SessionRecord } from "../config/types.js";

const mapping: Mapping = {
  identity: "auth-investigator",
  channel: "C1",
  workspace: "/repos/auth-service",
  scope: "channel",
  trigger: "auto",
};

describe("formatUtc", () => {
  it("formats ISO to YYYY-MM-DD HH:MM UTC", () => {
    expect(formatUtc("2026-06-29T14:10:00Z")).toBe("2026-06-29 14:10 UTC");
  });
});

describe("formatStatus", () => {
  it("includes identity and all required fields when a session exists", () => {
    const session: SessionRecord = {
      key: "C1",
      identity: "auth-investigator",
      claudeSessionId: "sess_12345",
      messagesProcessed: 42,
      createdAt: "2026-06-29T14:10:00Z",
    };
    const out = formatStatus(mapping, session);
    expect(out).toContain("[auth-investigator]");
    expect(out).toContain("Workspace:\n/repos/auth-service");
    expect(out).toContain("Session Scope:\nChannel");
    expect(out).toContain("Trigger Mode:\nAuto");
    expect(out).toContain("Session ID:\nsess_12345");
    expect(out).toContain("Messages Processed:\n42");
    expect(out).toContain("Started:\n2026-06-29 14:10 UTC");
  });

  it("renders gracefully before a session is created", () => {
    const out = formatStatus(mapping, undefined);
    expect(out).toContain("Session ID:\n(not started)");
    expect(out).toContain("Messages Processed:\n0");
  });
});

describe("withIdentity", () => {
  it("prefixes reply text with the identity tag", () => {
    expect(withIdentity("auth-investigator", "hello")).toBe("[auth-investigator]\n\nhello");
  });
});
