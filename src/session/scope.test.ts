import { describe, it, expect } from "vitest";
import { sessionKey, replyThreadTs } from "./scope.js";

describe("sessionKey", () => {
  it("channel scope keys on channel_id only", () => {
    expect(sessionKey("channel", { channel: "C1", ts: "100.1", threadTs: "99.0" })).toBe("C1");
  });

  it("thread scope keys on channel_id + thread_ts", () => {
    expect(sessionKey("thread", { channel: "C1", ts: "100.1", threadTs: "99.0" })).toBe("C1:99.0");
  });

  it("thread scope on a top-level message uses its own ts as the thread root", () => {
    expect(sessionKey("thread", { channel: "C1", ts: "100.1" })).toBe("C1:100.1");
  });
});

describe("replyThreadTs", () => {
  it("channel scope posts to the channel (no thread)", () => {
    expect(
      replyThreadTs("channel", { channel: "C1", ts: "100.1", threadTs: "99.0" }),
    ).toBeUndefined();
  });

  it("thread scope posts under the existing thread root", () => {
    expect(replyThreadTs("thread", { channel: "C1", ts: "100.1", threadTs: "99.0" })).toBe("99.0");
  });

  it("thread scope on a new thread uses the message ts", () => {
    expect(replyThreadTs("thread", { channel: "C1", ts: "100.1" })).toBe("100.1");
  });
});
