import { describe, it, expect, vi } from "vitest";
import { ChannelResolver } from "./channel-lookup.js";
import { Logger } from "../logger.js";

describe("ChannelResolver", () => {
  it("resolves #name and caches success", async () => {
    let calls = 0;
    const r = new ChannelResolver({
      conversations: {
        info: async () => {
          calls++;
          return { channel: { name: "eng" } };
        },
      },
    });
    expect(await r.resolve("C1")).toBe("#eng");
    expect(await r.resolve("C1")).toBe("#eng");
    expect(calls).toBe(1);
  });

  it("falls back to the raw id on error, without caching", async () => {
    let calls = 0;
    const r = new ChannelResolver({
      conversations: {
        info: async () => {
          calls++;
          throw { data: { error: "channel_not_found" } };
        },
      },
    });
    expect(await r.resolve("C9")).toBe("C9");
    expect(await r.resolve("C9")).toBe("C9");
    expect(calls).toBe(2);
  });

  it("returns raw id when channel name is empty/whitespace, without caching", async () => {
    let calls = 0;
    const r = new ChannelResolver({
      conversations: {
        info: async () => {
          calls++;
          return { channel: { name: "   " } };
        },
      },
    });
    expect(await r.resolve("C1")).toBe("C1");
    expect(await r.resolve("C1")).toBe("C1");
    expect(calls).toBe(2);
  });

  it("logs a warning with the channel id and underlying error on a lookup failure", async () => {
    const info = async () => {
      throw { data: { error: "channel_not_found" } };
    };
    const warn = vi.fn();
    const r = new ChannelResolver({ conversations: { info } }, { warn } as unknown as Logger);
    expect(await r.resolve("C9")).toBe("C9");
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("C9");
    expect(message).toContain("channel_not_found");
  });
});
