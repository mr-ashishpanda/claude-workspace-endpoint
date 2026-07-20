import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeMessage,
  makeMessageHandler,
  mentionsUser,
  extractText,
  notifyStartup,
  SlackPostClient,
} from "./app.js";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { Logger } from "../logger.js";
import { HandlerDeps } from "./handler.js";
import { Mapping } from "../config/types.js";

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

  it("allows the file_share subtype and extracts attachments", () => {
    const m = normalizeMessage(
      {
        subtype: "file_share",
        channel: "C1",
        ts: "100.5",
        text: "look",
        files: [
          {
            id: "F1",
            name: "diagram.png",
            mimetype: "image/png",
            url_private: "https://files.slack.com/F1",
          },
        ],
      },
      BOT,
    );
    expect(m).not.toBeNull();
    expect(m?.files).toEqual([
      {
        id: "F1",
        name: "diagram.png",
        mimetype: "image/png",
        urlPrivate: "https://files.slack.com/F1",
      },
    ]);
  });

  it("omits files entirely when the message has none", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "hi" }, BOT);
    expect(m).not.toHaveProperty("files");
  });

  it("carries the sender's Slack user id", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "hi", user: "U555" }, BOT);
    expect(m?.user).toBe("U555");
  });

  it("omits user when the raw event has none", () => {
    const m = normalizeMessage({ channel: "C1", ts: "1", text: "hi" }, BOT);
    expect(m?.user).toBeUndefined();
  });
});

describe("extractText", () => {
  it("falls back to the flat text field when there are no blocks", () => {
    expect(extractText({ text: "hello world" })).toBe("hello world");
  });

  it("reconstructs authored text from rich_text and ignores a context footer", () => {
    // Shape mirrors what Slack sends: a "Sent using Claude" footer context
    // block flattened into `text` must NOT pollute the command.
    const raw = {
      text: "<@U1TESTUSER> status *Sent using* Claude",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "user", user_id: "U1TESTUSER" },
                { type: "text", text: " status" },
              ],
            },
          ],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "*Sent using* Claude" }],
        },
      ],
    };
    expect(extractText(raw)).toBe("<@U1TESTUSER> status");
  });

  it("renders channels, emoji, and links inside rich_text", () => {
    const raw = {
      text: "ignored",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "see " },
                { type: "channel", channel_id: "C123" },
                { type: "text", text: " " },
                { type: "emoji", name: "wave" },
                { type: "text", text: " " },
                { type: "link", url: "https://x.test", text: "x" },
              ],
            },
          ],
        },
      ],
    };
    expect(extractText(raw)).toBe("see <#C123> :wave: x");
  });

  it("falls back to text when rich_text reconstructs to empty", () => {
    const raw = { text: "fallback", blocks: [{ type: "rich_text", elements: [] }] };
    expect(extractText(raw)).toBe("fallback");
  });
});

describe("normalizeMessage with blocks", () => {
  it("detects @claude status when a footer context block is present", () => {
    const m = normalizeMessage(
      {
        channel: "C1",
        ts: "1",
        text: "<@UBOT> status *Sent using* Claude",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "user", user_id: "UBOT" },
                  { type: "text", text: " status" },
                ],
              },
            ],
          },
          { type: "context", elements: [{ type: "mrkdwn", text: "*Sent using* Claude" }] },
        ],
      },
      "UBOT",
    );
    expect(m?.text).toBe("<@UBOT> status");
    expect(m?.mentionsBot).toBe(true);
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
    expect(calls[0]!.text).toContain("auth-investigator | s1");
    rmSync(home, { recursive: true, force: true });
  });

  it("thread scope posts with the thread_ts set", async () => {
    const { handler, client, calls, home } = harness("thread");
    await handler({ channel: "C1", ts: "100.1", thread_ts: "99.0", text: "look here" }, client);
    expect(calls[0]!.thread_ts).toBe("99.0");
    rmSync(home, { recursive: true, force: true });
  });

  it("wires reactions.add/remove through to the handler when the client provides them", async () => {
    const home = mkdtempSync(join(tmpdir(), "scb-app-react-"));
    const mappings = MappingStore.load(home);
    mappings.add({
      identity: "auth-investigator",
      channel: "C1",
      workspace: "/repos/auth",
      scope: "channel",
      trigger: "auto",
    });
    const sessions = SessionStore.load(home);
    const reactionCalls: { action: string; channel: string; timestamp: string; name: string }[] =
      [];
    const client: SlackPostClient = {
      chat: { postMessage: async () => ({}) },
      reactions: {
        add: async (args) => {
          reactionCalls.push({ action: "add", ...args });
          return {};
        },
        remove: async (args) => {
          reactionCalls.push({ action: "remove", ...args });
          return {};
        },
      },
    };
    const deps: Omit<HandlerDeps, "post" | "react"> = {
      mappings,
      sessions,
      logger: new Logger("test", {}),
      claudeBin: "claude",
      invoke: async () => ({ text: "reply", sessionId: "s1" }),
    };
    const handler = makeMessageHandler(deps, () => BOT);
    await handler({ channel: "C1", ts: "100.1", text: "deploy failed" }, client);
    expect(reactionCalls).toEqual([
      { action: "add", channel: "C1", timestamp: "100.1", name: "eyes" },
      { action: "remove", channel: "C1", timestamp: "100.1", name: "eyes" },
      { action: "add", channel: "C1", timestamp: "100.1", name: "white_check_mark" },
    ]);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("notifyStartup", () => {
  function fakeLogger() {
    return new Logger("bridge", {});
  }

  const mapping = (over: Partial<Mapping> = {}): Mapping => ({
    identity: "auth-investigator",
    channel: "C1",
    workspace: "/repos/auth",
    scope: "channel",
    trigger: "auto",
    model: "default",
    skipPermissions: false,
    slackPrefix: false,
    ...over,
  });

  it("posts an identity-prefixed ready notice naming the host to every mapping's channel", async () => {
    const calls: { channel: string; text: string }[] = [];
    const client: SlackPostClient = {
      chat: {
        postMessage: async (args) => {
          calls.push({ channel: args.channel, text: args.text });
          return {};
        },
      },
    };
    await notifyStartup(
      client,
      [mapping({ identity: "a", channel: "C1" }), mapping({ identity: "b", channel: "C2" })],
      fakeLogger(),
      "ip-10-0-0-222",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.channel).toBe("C1");
    expect(calls[0]!.text).toContain("[a]");
    expect(calls[0]!.text).toContain("ready to receive messages from `ip-10-0-0-222`");
    expect(calls[1]!.channel).toBe("C2");
    expect(calls[1]!.text).toContain("[b]");
  });

  it("does not throw when a mapping's channel post fails (e.g. bad/un-invited channel)", async () => {
    const client: SlackPostClient = {
      chat: {
        postMessage: async () => {
          throw Object.assign(new Error("channel_not_found"), {
            data: { error: "channel_not_found" },
          });
        },
      },
    };
    await expect(notifyStartup(client, [mapping()], fakeLogger(), "host")).resolves.toBeUndefined();
  });
});
