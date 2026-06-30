import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { Logger } from "../logger.js";
import { handleInbound, HandlerDeps } from "./handler.js";
import { InboundMessage } from "./router.js";
import { ClaudeResult } from "../claude/invoke.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scb-h-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

interface Post {
  channel: string;
  text: string;
  threadTs: string | undefined;
}

function setup(over: Partial<{ scope: "channel" | "thread"; trigger: "mention" | "auto" }> = {}) {
  const mappings = MappingStore.load(home);
  mappings.add({
    identity: "auth-investigator",
    channel: "C1",
    workspace: "/repos/auth",
    scope: over.scope ?? "channel",
    trigger: over.trigger ?? "auto",
  });
  const sessions = SessionStore.load(home);
  const posts: Post[] = [];
  const invokes: { prompt: string; resume: string | null }[] = [];
  const invoke = async (a: {
    prompt: string;
    resumeSessionId: string | null;
  }): Promise<ClaudeResult> => {
    invokes.push({ prompt: a.prompt, resume: a.resumeSessionId });
    return { text: "claude reply", sessionId: "sess_new" };
  };
  const deps: HandlerDeps = {
    mappings,
    sessions,
    logger: new Logger("test", {}),
    claudeBin: "claude",
    post: async (channel, text, threadTs) => {
      posts.push({ channel, text, threadTs });
    },
    invoke,
  };
  return { deps, sessions, posts, invokes };
}

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return { channel: "C1", ts: "100.1", text: "hi", mentionsBot: false, fromBot: false, ...over };
}

describe("handleInbound", () => {
  it("auto trigger: invokes claude and posts identity-prefixed reply to channel", async () => {
    const { deps, posts, invokes } = setup({ scope: "channel", trigger: "auto" });
    await handleInbound(deps, msg({ text: "deploy failed" }));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]!.prompt).toBe("deploy failed");
    expect(posts[0]!.text).toContain("[auth-investigator]");
    expect(posts[0]!.text).toContain("claude reply");
    expect(posts[0]!.threadTs).toBeUndefined();
  });

  it("persists and reuses the claude session id across messages", async () => {
    const { deps, sessions, invokes } = setup({ trigger: "auto" });
    await handleInbound(deps, msg());
    await handleInbound(deps, msg({ ts: "101.0" }));
    expect(invokes[0]!.resume).toBeNull();
    expect(invokes[1]!.resume).toBe("sess_new");
    expect(sessions.get("C1")?.messagesProcessed).toBe(2);
  });

  it("mention trigger ignores non-mentions", async () => {
    const { deps, invokes, posts } = setup({ trigger: "mention" });
    await handleInbound(deps, msg({ text: "chatter", mentionsBot: false }));
    expect(invokes).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });

  it("@claude status posts status without invoking claude", async () => {
    const { deps, posts, invokes } = setup({ trigger: "auto" });
    await handleInbound(deps, msg({ text: "<@UBOT> status", mentionsBot: true }));
    expect(invokes).toHaveLength(0);
    expect(posts[0]!.text).toContain("Session Scope:");
  });

  it("thread scope posts in-thread and keys per thread", async () => {
    const { deps, posts, sessions } = setup({ scope: "thread", trigger: "auto" });
    await handleInbound(deps, msg({ threadTs: "99.0" }));
    expect(posts[0]!.threadTs).toBe("99.0");
    expect(sessions.get("C1:99.0")).toBeDefined();
  });

  it("ignores bot messages (no loops)", async () => {
    const { deps, invokes, posts } = setup({ trigger: "auto" });
    await handleInbound(deps, msg({ fromBot: true }));
    expect(invokes).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });
});
