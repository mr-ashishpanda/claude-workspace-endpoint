import { describe, it, expect } from "vitest";
import { ChannelResolver } from "./channel-lookup.js";

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
});
