import { describe, it, expect } from "vitest";
import { withSlackPrefix } from "./slack-prefix.js";

describe("withSlackPrefix", () => {
  it("includes both the resolved name and the user id when a resolver is provided", async () => {
    const resolveUser = async (id: string) => `name-for-${id}`;
    const result = await withSlackPrefix("deploy failed", "U1", resolveUser);
    expect(result).toBe("[Slack: name-for-U1 (U1)] deploy failed");
  });

  it("degrades to the bare user id when the resolver falls back to the id itself (lookup failure)", async () => {
    const resolveUser = async (id: string) => id;
    const result = await withSlackPrefix("deploy failed", "U1", resolveUser);
    expect(result).toBe("[Slack: U1] deploy failed");
  });

  it("falls back to the raw user id when no resolver is provided", async () => {
    const result = await withSlackPrefix("deploy failed", "U1", undefined);
    expect(result).toBe("[Slack: U1] deploy failed");
  });

  it("falls back to 'unknown' when there is no user id at all", async () => {
    const result = await withSlackPrefix("deploy failed", undefined, undefined);
    expect(result).toBe("[Slack: unknown] deploy failed");
  });

  it("returns the bare tag (no trailing space) when text is empty", async () => {
    const result = await withSlackPrefix("", "U1", undefined);
    expect(result).toBe("[Slack: U1]");
  });

  it("returns the bare tag with name and id when text is empty and the resolver succeeds", async () => {
    const resolveUser = async (id: string) => `name-for-${id}`;
    const result = await withSlackPrefix("", "U1", resolveUser);
    expect(result).toBe("[Slack: name-for-U1 (U1)]");
  });
});
