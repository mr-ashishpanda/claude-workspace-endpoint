import { describe, it, expect } from "vitest";
import { checkChannelAccess, ChannelCheckClient } from "./channel-check.js";

function fakeClient(impl: ChannelCheckClient["conversations"]["info"]): ChannelCheckClient {
  return { conversations: { info: impl } };
}

describe("checkChannelAccess", () => {
  it("succeeds when the bot is a member of the channel", async () => {
    const client = fakeClient(async () => ({ channel: { is_member: true } }));
    const result = await checkChannelAccess("xoxb-token", "C123", client);
    expect(result).toEqual({ ok: true });
  });

  it("fails when the bot is not a member of the channel", async () => {
    const client = fakeClient(async () => ({ channel: { is_member: false } }));
    const result = await checkChannelAccess("xoxb-token", "C123", client);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a member/);
  });

  it("surfaces the Slack API error (e.g. channel_not_found)", async () => {
    const err = Object.assign(new Error("An API error occurred: channel_not_found"), {
      data: { ok: false, error: "channel_not_found" },
    });
    const client = fakeClient(async () => {
      throw err;
    });
    const result = await checkChannelAccess("xoxb-token", "C123", client);
    expect(result).toEqual({ ok: false, error: "channel_not_found" });
  });

  it("falls back to the raw error message when there's no Slack error code", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    const result = await checkChannelAccess("xoxb-token", "C123", client);
    expect(result).toEqual({ ok: false, error: "network down" });
  });

  it("treats a missing is_member as ok (older/lighter API responses)", async () => {
    const client = fakeClient(async () => ({ channel: {} }));
    const result = await checkChannelAccess("xoxb-token", "C123", client);
    expect(result).toEqual({ ok: true });
  });
});
