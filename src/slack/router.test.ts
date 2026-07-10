import { describe, it, expect } from "vitest";
import { route, stripMentions, isStatusCommand, InboundMessage } from "./router.js";
import { SlackFile } from "./files.js";
import { Mapping } from "../config/types.js";

const image = (): SlackFile => ({
  id: "F1",
  name: "shot.png",
  mimetype: "image/png",
  urlPrivate: "https://files.slack.com/F1",
});

const BOT = "<@UBOT>";

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    identity: "auth-investigator",
    channel: "C1",
    workspace: "/repos/auth",
    scope: "channel",
    trigger: "mention",
    model: "default",
    skipPermissions: false,
    ...over,
  };
}

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "C1",
    ts: "100.1",
    text: "hello",
    mentionsBot: false,
    fromBot: false,
    ...over,
  };
}

describe("stripMentions / isStatusCommand", () => {
  it("removes mention tokens and trims", () => {
    expect(stripMentions(`${BOT} investigate this`)).toBe("investigate this");
  });
  it("removes the <@UID|Display Name> mention form too", () => {
    expect(stripMentions("<@UBOT|CWE Bot> status")).toBe("status");
    expect(stripMentions("<@UBOT|CWE Bot> look into this")).toBe("look into this");
  });
  it("detects the status command regardless of mention placement", () => {
    expect(isStatusCommand(`${BOT} status`)).toBe(true);
    expect(isStatusCommand(`status ${BOT}`)).toBe(true);
    expect(isStatusCommand(`${BOT} status now`)).toBe(false);
  });
});

describe("route — bot/loop safety", () => {
  it("ignores messages from bots", () => {
    expect(
      route(mapping(), msg({ fromBot: true, mentionsBot: true, text: `${BOT} status` })).action,
    ).toBe("ignore");
  });
});

describe("route — attachments count as content", () => {
  it("auto trigger: a file-only message (no text) still invokes", () => {
    const d = route(mapping({ trigger: "auto" }), msg({ text: "", files: [image()] }));
    expect(d.action).toBe("invoke");
  });

  it("mention trigger: a file with a mention invokes", () => {
    const d = route(
      mapping({ trigger: "mention" }),
      msg({ mentionsBot: true, text: `${BOT}`, files: [image()] }),
    );
    expect(d.action).toBe("invoke");
  });

  it("mention trigger: a file with NO mention is ignored", () => {
    const d = route(mapping({ trigger: "mention" }), msg({ text: "", files: [image()] }));
    expect(d.action).toBe("ignore");
  });

  it("still ignores an empty message with no attachments", () => {
    const d = route(mapping({ trigger: "auto" }), msg({ text: "   ", files: [] }));
    expect(d.action).toBe("ignore");
  });
});

describe("route — @claude status (all modes)", () => {
  for (const trigger of ["mention", "auto"] as const) {
    it(`returns status under ${trigger} trigger when mentioned`, () => {
      const d = route(mapping({ trigger }), msg({ mentionsBot: true, text: `${BOT} status` }));
      expect(d.action).toBe("status");
      expect(d.sessionKey).toBe("C1");
    });
  }
});

describe("route — mention trigger", () => {
  it("ignores non-mentions", () => {
    expect(route(mapping({ trigger: "mention" }), msg({ text: "just chatting" })).action).toBe(
      "ignore",
    );
  });
  it("invokes on a mention, stripping the mention from the prompt", () => {
    const d = route(
      mapping({ trigger: "mention" }),
      msg({ mentionsBot: true, text: `${BOT} look into X` }),
    );
    expect(d.action).toBe("invoke");
    expect(d.prompt).toBe("look into X");
  });
  it("ignores a bare mention with no other text", () => {
    expect(
      route(mapping({ trigger: "mention" }), msg({ mentionsBot: true, text: BOT })).action,
    ).toBe("ignore");
  });
});

describe("route — auto trigger", () => {
  it("invokes on every in-scope message with the full text", () => {
    const d = route(mapping({ trigger: "auto" }), msg({ text: "deploy started" }));
    expect(d.action).toBe("invoke");
    expect(d.prompt).toBe("deploy started");
  });
});

describe("route — scope reply targeting", () => {
  it("channel scope replies to the channel (no thread)", () => {
    const d = route(mapping({ scope: "channel", trigger: "auto" }), msg({ threadTs: "99.0" }));
    expect(d.replyThreadTs).toBeUndefined();
  });
  it("thread scope replies in-thread and keys per thread", () => {
    const d = route(mapping({ scope: "thread", trigger: "auto" }), msg({ threadTs: "99.0" }));
    expect(d.replyThreadTs).toBe("99.0");
    expect(d.sessionKey).toBe("C1:99.0");
  });
});
