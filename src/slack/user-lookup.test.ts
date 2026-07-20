import { describe, it, expect, vi } from "vitest";
import { UserResolver, UserLookupClient } from "./user-lookup.js";
import { Logger } from "../logger.js";

function fakeClient(impl: UserLookupClient["users"]["info"]): UserLookupClient {
  return { users: { info: impl } };
}

describe("UserResolver", () => {
  it("prefers profile.display_name", async () => {
    const client = fakeClient(async () => ({
      user: { profile: { display_name: "jane.doe" }, real_name: "Jane Doe", name: "jane" },
    }));
    const resolver = new UserResolver(client);
    expect(await resolver.resolve("U1")).toBe("jane.doe");
  });

  it("falls back to real_name when display_name is blank", async () => {
    const client = fakeClient(async () => ({
      user: { profile: { display_name: "" }, real_name: "Jane Doe", name: "jane" },
    }));
    const resolver = new UserResolver(client);
    expect(await resolver.resolve("U1")).toBe("Jane Doe");
  });

  it("falls back to name, then the raw id, when nothing else is set", async () => {
    const client = fakeClient(async () => ({ user: { name: "jane" } }));
    expect(await new UserResolver(client).resolve("U1")).toBe("jane");

    const emptyClient = fakeClient(async () => ({ user: {} }));
    expect(await new UserResolver(emptyClient).resolve("U1")).toBe("U1");
  });

  it("caches a successful lookup — the client is called only once per user id", async () => {
    const info = vi.fn(async () => ({ user: { profile: { display_name: "jane.doe" } } }));
    const resolver = new UserResolver({ users: { info } });
    await resolver.resolve("U1");
    await resolver.resolve("U1");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw id on a lookup failure, without caching it", async () => {
    let calls = 0;
    const info = async () => {
      calls += 1;
      throw new Error("rate_limited");
    };
    const resolver = new UserResolver({ users: { info } });
    expect(await resolver.resolve("U1")).toBe("U1");
    expect(await resolver.resolve("U1")).toBe("U1");
    expect(calls).toBe(2); // not cached — retried on the second call
  });

  it("logs a warning with the user id and underlying error on a lookup failure", async () => {
    const info = async () => {
      throw new Error("missing_scope");
    };
    const warn = vi.fn();
    const resolver = new UserResolver({ users: { info } }, { warn } as unknown as Logger);
    await resolver.resolve("U1");
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("U1");
    expect(message).toContain("missing_scope");
  });
});
