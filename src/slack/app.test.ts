import { describe, it, expect } from "vitest";
import { normalizeMessage } from "./app.js";

const BOT = "UBOT";

describe("normalizeMessage", () => {
  it("normalizes a plain user message", () => {
    const m = normalizeMessage({ channel: "C1", ts: "100.1", text: "hello" }, BOT);
    expect(m).toEqual({
      channel: "C1",
      ts: "100.1",
      threadTs: undefined,
      text: "hello",
      mentionsBot: false,
      fromBot: false,
    });
  });

  it("captures thread_ts for thread replies", () => {
    const m = normalizeMessage({ channel: "C1", ts: "100.2", thread_ts: "99.0", text: "x" }, BOT);
    expect(m?.threadTs).toBe("99.0");
  });

  it("detects a mention of the bot user", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: `<@${BOT}> status` }, BOT);
    expect(m?.mentionsBot).toBe(true);
  });

  it("does not flag a mention of a different user", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "<@USOMEONE> hi" }, BOT);
    expect(m?.mentionsBot).toBe(false);
  });

  it("marks messages with a bot_id as fromBot (loop safety)", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "x", bot_id: "B1" }, BOT);
    expect(m?.fromBot).toBe(true);
  });

  it("ignores message subtypes (edits, joins, deletes, bot_message)", () => {
    for (const subtype of ["message_changed", "message_deleted", "channel_join", "bot_message"]) {
      expect(normalizeMessage({ subtype, channel: "C1", ts: "1", text: "x" }, BOT)).toBeNull();
    }
  });

  it("allows thread_broadcast as a real message", () => {
    const m = normalizeMessage(
      { subtype: "thread_broadcast", channel: "C1", ts: "1", thread_ts: "0.9", text: "x" },
      BOT,
    );
    expect(m).not.toBeNull();
    expect(m?.threadTs).toBe("0.9");
  });

  it("returns null when channel or ts is missing", () => {
    expect(normalizeMessage({ ts: "1", text: "x" }, BOT)).toBeNull();
    expect(normalizeMessage({ channel: "C1", text: "x" }, BOT)).toBeNull();
  });

  it("treats missing text as empty", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1" }, BOT);
    expect(m?.text).toBe("");
  });
});
