import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { KeyedSerializer } from "../session/serializer.js";
import { Logger } from "../logger.js";
import { handleInbound, HandlerDeps } from "./handler.js";
import { InboundMessage } from "./router.js";
import { ClaudeResult } from "../claude/invoke.js";
import { MediaStore } from "../session/media.js";
import { SlackFile } from "./files.js";

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
  const downloads: string[] = [];
  const download = async (f: SlackFile): Promise<Buffer> => {
    downloads.push(f.id);
    return Buffer.from(`bytes-of-${f.name}`);
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
    download,
    media: new MediaStore(home),
  };
  return { deps, sessions, posts, invokes, downloads, home };
}

const image = (over: Partial<SlackFile> = {}): SlackFile => ({
  id: "F1",
  name: "diagram.png",
  mimetype: "image/png",
  urlPrivate: "https://files.slack.com/F1",
  ...over,
});

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return { channel: "C1", ts: "100.1", text: "hi", mentionsBot: false, fromBot: false, ...over };
}

describe("handleInbound", () => {
  it("auto trigger: invokes claude and posts identity-prefixed reply to channel", async () => {
    const { deps, posts, invokes } = setup({ scope: "channel", trigger: "auto" });
    await handleInbound(deps, msg({ text: "deploy failed" }));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]!.prompt).toBe("deploy failed");
    expect(posts[0]!.text).toContain("auth-investigator | sess_new");
    expect(posts[0]!.text).toContain("claude reply");
    expect(posts[0]!.threadTs).toBeUndefined();
  });

  it("heads every reply with 'identity | session-id' exactly once (no duplicate footer)", async () => {
    const { deps, posts } = setup({ trigger: "auto" });
    await handleInbound(deps, msg({ text: "first" }));
    await handleInbound(deps, msg({ ts: "101.0", text: "second" }));

    for (const p of posts) {
      expect(p.text).toContain("auth-investigator | sess_new");
      // Identity token occurs exactly once — header only, no separate footer.
      expect(p.text.match(/auth-investigator/g)?.length).toBe(1);
    }
  });

  it("recovers from a stale/unresumable session by retrying without --resume", async () => {
    const { deps, sessions, posts } = setup({ trigger: "auto" });
    // Seed a session whose stored Claude id is no longer resumable.
    sessions.getOrCreate("C1", "auth-investigator");
    sessions.setClaudeSessionId("C1", "stale-id");

    const attempts: (string | null)[] = [];
    deps.invoke = async (a) => {
      attempts.push(a.resumeSessionId);
      if (a.resumeSessionId) throw new Error("claude exited with code 1"); // stale resume fails
      return { text: "fresh answer", sessionId: "brand-new-id" };
    };

    await handleInbound(deps, msg({ text: "hello again" }));

    // Tried the stale id, then retried fresh.
    expect(attempts).toEqual(["stale-id", null]);
    // Stored id is replaced with the new one.
    expect(sessions.get("C1")?.claudeSessionId).toBe("brand-new-id");
    expect(posts[0]!.text).toContain("fresh answer");
    // A recovered message still counts as processed.
    expect(sessions.get("C1")?.messagesProcessed).toBe(1);
  });

  it("does not attempt to resume when the stored config dir no longer matches", async () => {
    const { deps, sessions, posts } = setup({ trigger: "auto" });
    // Session was created under a different CLAUDE_CONFIG_DIR than the mapping now uses.
    sessions.getOrCreate("C1", "auth-investigator");
    sessions.setClaudeSessionId("C1", "id-from-other-config", "/home/me/.claude-other");

    const attempts: (string | null)[] = [];
    deps.invoke = async (a) => {
      attempts.push(a.resumeSessionId);
      return { text: "ok", sessionId: "id-under-default" };
    };

    await handleInbound(deps, msg({ text: "hi" }));

    // No doomed resume: went straight to a fresh session (single attempt, null).
    expect(attempts).toEqual([null]);
    expect(sessions.get("C1")?.claudeSessionId).toBe("id-under-default");
    expect(sessions.get("C1")?.claudeConfigDir).toBeUndefined(); // mapping uses default
    expect(posts[0]!.text).toContain("ok");
  });

  it("stores the mapping's config dir with a newly-established session", async () => {
    const mappings = MappingStore.load(home);
    mappings.add({
      identity: "cfg-agent",
      channel: "C1",
      workspace: "/repos/x",
      scope: "channel",
      trigger: "auto",
      claudeConfigDir: "/home/me/.claude-custom",
    });
    const sessions = SessionStore.load(home);
    const seen: { resume: string | null; cfg?: string }[] = [];
    const deps: HandlerDeps = {
      mappings,
      sessions,
      logger: new Logger("test", {}),
      claudeBin: "claude",
      post: async () => {},
      invoke: async (a) => {
        seen.push({ resume: a.resumeSessionId, cfg: a.claudeConfigDir });
        return { text: "r", sessionId: "s1" };
      },
    };
    await handleInbound(deps, msg({ text: "hi" }));
    expect(seen[0]!.cfg).toBe("/home/me/.claude-custom");
    expect(sessions.get("C1")?.claudeConfigDir).toBe("/home/me/.claude-custom");
  });

  it("does not retry when there was no session to resume (reports the failure once)", async () => {
    const { deps, posts } = setup({ trigger: "auto" });
    let calls = 0;
    deps.invoke = async () => {
      calls += 1;
      throw new Error("spawn claude ENOENT");
    };
    await handleInbound(deps, msg({ text: "do it" }));
    expect(calls).toBe(1); // no fresh-retry when there was no resume id
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toContain(":warning:");
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

  it("posts an identity-prefixed warning when the Claude invocation fails", async () => {
    const { deps, sessions, posts } = setup({ trigger: "auto" });
    // Override invoke to throw, simulating e.g. a missing claude binary.
    deps.invoke = async () => {
      throw new Error("spawn claude ENOENT");
    };
    await handleInbound(deps, msg({ text: "do it" }));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toContain("[auth-investigator]");
    expect(posts[0]!.text).toContain(":warning:");
    expect(posts[0]!.text).toContain("ENOENT");
    // A failed invocation must not count toward messages processed.
    expect(sessions.get("C1")?.messagesProcessed).toBe(0);
  });

  it("end-to-end with NO fakes: real claude invocation + session persistence", async () => {
    // Whole non-Slack vertical slice: handler → real invokeClaude → real spawn
    // of a stub `claude` → JSON parse → session id captured and reused.
    const bin = join(home, "claude-stub");
    writeFileSync(
      bin,
      `#!/usr/bin/env node
let s = "";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  const resumed = process.argv.includes("--resume");
  process.stdout.write(JSON.stringify({ result: resumed ? "resumed" : "fresh", session_id: "stub-session" }));
});
`,
    );
    chmodSync(bin, 0o755);

    const mappings = MappingStore.load(home);
    mappings.add({
      identity: "auth-investigator",
      channel: "C1",
      workspace: home,
      scope: "channel",
      trigger: "auto",
    });
    const sessions = SessionStore.load(home);
    const posts: Post[] = [];
    const deps: HandlerDeps = {
      mappings,
      sessions,
      logger: new Logger("test", {}),
      claudeBin: bin,
      post: async (channel, text, threadTs) => {
        posts.push({ channel, text, threadTs });
      },
    };

    await handleInbound(deps, msg({ ts: "100.1" }));
    expect(sessions.get("C1")?.claudeSessionId).toBe("stub-session");
    expect(posts[0]!.text).toContain("auth-investigator | stub-session");
    expect(posts[0]!.text).toContain("fresh");

    await handleInbound(deps, msg({ ts: "100.2" }));
    expect(posts[1]!.text).toContain("resumed"); // second message resumed the session
    expect(sessions.get("C1")?.messagesProcessed).toBe(2);
  });

  it("downloads a supported image, caches it, and augments the prompt with its path", async () => {
    const { deps, posts, invokes, downloads, home } = setup({ trigger: "auto" });
    await handleInbound(deps, msg({ text: "what is this?", files: [image({ id: "IMG" })] }));

    expect(downloads).toEqual(["IMG"]);
    expect(invokes).toHaveLength(1);
    // The prompt carries the caption plus the cached absolute path under the app data dir.
    expect(invokes[0]!.prompt).toContain("what is this?");
    expect(invokes[0]!.prompt).toContain(join(home, "media"));
    expect(invokes[0]!.prompt).toContain("diagram.png");
    // The file was actually written where the prompt points.
    const line = invokes[0]!.prompt.split("\n").find((l) => l.includes("diagram.png"))!;
    const path = line.replace(/^-\s*/, "").trim();
    expect(readFileSync(path).toString()).toBe("bytes-of-diagram.png");
    expect(posts[0]!.text).toContain("claude reply");
  });

  it("invokes on an image-only message (no caption)", async () => {
    const { deps, invokes } = setup({ trigger: "auto" });
    await handleInbound(deps, msg({ text: "", files: [image()] }));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]!.prompt).toContain("diagram.png");
  });

  it("posts a not-supported notice and does NOT invoke for an unsupported-only upload", async () => {
    const { deps, posts, invokes, downloads } = setup({ trigger: "auto" });
    await handleInbound(
      deps,
      msg({
        text: "",
        files: [image({ id: "P", name: "report.pdf", mimetype: "application/pdf" })],
      }),
    );
    expect(invokes).toHaveLength(0);
    expect(downloads).toHaveLength(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toContain("[auth-investigator]");
    expect(posts[0]!.text).toContain("not supported");
    expect(posts[0]!.text).toContain("report.pdf");
  });

  it("mixed upload: notifies about unsupported files AND invokes with the image", async () => {
    const { deps, posts, invokes, downloads } = setup({ trigger: "auto" });
    await handleInbound(
      deps,
      msg({
        text: "review these",
        files: [
          image({ id: "OK", name: "ok.png" }),
          image({ id: "BAD", name: "notes.txt", mimetype: "text/plain" }),
        ],
      }),
    );
    expect(downloads).toEqual(["OK"]);
    expect(invokes).toHaveLength(1);
    expect(invokes[0]!.prompt).toContain("ok.png");
    const notice = posts.find((p) => p.text.includes("not supported"));
    expect(notice).toBeDefined();
    expect(notice!.text).toContain("notes.txt");
  });

  it("an unsupported-only upload does not create a session", async () => {
    const { deps, sessions } = setup({ trigger: "auto" });
    await handleInbound(
      deps,
      msg({ text: "", files: [image({ mimetype: "application/pdf", name: "x.pdf" })] }),
    );
    expect(sessions.get("C1")).toBeUndefined();
  });

  it("serializes concurrent same-key messages so they reuse one session", async () => {
    const mappings = MappingStore.load(home);
    mappings.add({
      identity: "auth-investigator",
      channel: "C1",
      workspace: "/repos/auth",
      scope: "channel",
      trigger: "auto",
    });
    const sessions = SessionStore.load(home);
    const invokes: (string | null)[] = [];
    // A deliberately slow invoke so both messages are in flight at once — the
    // exact condition that, without serialization, makes both start a *new*
    // Claude session (resume=null).
    const invoke = async (a: { resumeSessionId: string | null }): Promise<ClaudeResult> => {
      invokes.push(a.resumeSessionId);
      await new Promise((r) => setTimeout(r, 5));
      return { text: "reply", sessionId: "sess_new" };
    };
    const deps: HandlerDeps = {
      mappings,
      sessions,
      logger: new Logger("test", {}),
      claudeBin: "claude",
      serializer: new KeyedSerializer(),
      post: async () => {},
      invoke,
    };

    await Promise.all([
      handleInbound(deps, msg({ ts: "100.1" })),
      handleInbound(deps, msg({ ts: "100.2" })),
    ]);

    expect(invokes).toEqual([null, "sess_new"]); // first new, second resumes
    expect(sessions.get("C1")?.messagesProcessed).toBe(2);
  });
});
