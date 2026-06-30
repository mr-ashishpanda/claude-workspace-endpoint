import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeMessage, makeMessageHandler, mentionsUser, SlackPostClient } from "./app.js";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { Logger } from "../logger.js";
import { HandlerDeps } from "./handler.js";

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

  it("detects the <@UID|Display Name> mention form (real Slack traffic)", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: `<@${BOT}|CWE Bot> status` }, BOT);
    expect(m?.mentionsBot).toBe(true);
  });

  it("does not flag a mention of a different user", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "<@USOMEONE> hi" }, BOT);
    expect(m?.mentionsBot).toBe(false);
  });
});

describe("mentionsUser", () => {
  it("matches both <@UID> and <@UID|name> and nothing else", () => {
    expect(mentionsUser("<@UBOT> hi", "UBOT")).toBe(true);
    expect(mentionsUser("<@UBOT|CWE Bot> hi", "UBOT")).toBe(true);
    expect(mentionsUser("<@UOTHER> hi", "UBOT")).toBe(false);
    expect(mentionsUser("no mention", "UBOT")).toBe(false);
    expect(mentionsUser("<@UBOT> hi", "")).toBe(false);
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

describe("makeMessageHandler (Bolt glue → chat.postMessage)", () => {
  interface PostArgs {
    channel: string;
    text: string;
    thread_ts?: string;
  }

  function harness(scope: "channel" | "thread") {
    const home = mkdtempSync(join(tmpdir(), "scb-app-"));
    const mappings = MappingStore.load(home);
    mappings.add({
      identity: "auth-investigator",
      channel: "C1",
      workspace: "/repos/auth",
      scope,
      trigger: "auto",
    });
    const sessions = SessionStore.load(home);
    const calls: PostArgs[] = [];
    const client: SlackPostClient = {
      chat: {
        postMessage: async (args) => {
          calls.push(args);
          return {};
        },
      },
    };
    const deps: Omit<HandlerDeps, "post"> = {
      mappings,
      sessions,
      logger: new Logger("test", {}),
      claudeBin: "claude",
      invoke: async () => ({ text: "reply", sessionId: "s1" }),
    };
    const handler = makeMessageHandler(deps, () => BOT);
    return { handler, client, calls, home };
  }

  it("ignores events that normalize to null (subtype) — no post", async () => {
    const { handler, client, calls, home } = harness("channel");
    await handler({ subtype: "message_changed", channel: "C1", ts: "1", text: "x" }, client);
    expect(calls).toHaveLength(0);
    rmSync(home, { recursive: true, force: true });
  });

  it("channel scope posts to the channel with no thread_ts", async () => {
    const { handler, client, calls, home } = harness("channel");
    await handler({ channel: "C1", ts: "100.1", thread_ts: "99.0", text: "deploy failed" }, client);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.channel).toBe("C1");
    expect(calls[0]!.thread_ts).toBeUndefined();
    expect(calls[0]!.text).toContain("[auth-investigator]");
    rmSync(home, { recursive: true, force: true });
  });

  it("thread scope posts with the thread_ts set", async () => {
    const { handler, client, calls, home } = harness("thread");
    await handler({ channel: "C1", ts: "100.1", thread_ts: "99.0", text: "look here" }, client);
    expect(calls[0]!.thread_ts).toBe("99.0");
    rmSync(home, { recursive: true, force: true });
  });
});
