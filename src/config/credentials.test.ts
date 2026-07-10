import { describe, it, expect } from "vitest";
import { loadCredentials, claudeBin, MissingCredentialsError } from "./credentials.js";

const full = {
  SLACK_BOT_TOKEN: "xoxb-1",
  SLACK_APP_TOKEN: "xapp-1",
  SLACK_SIGNING_SECRET: "secret",
};

describe("loadCredentials", () => {
  it("reads all three credentials from the environment", () => {
    expect(loadCredentials({ ...full })).toEqual({
      botToken: "xoxb-1",
      appToken: "xapp-1",
      signingSecret: "secret",
    });
  });

  it("trims surrounding whitespace", () => {
    const creds = loadCredentials({
      SLACK_BOT_TOKEN: "  xoxb-1 ",
      SLACK_APP_TOKEN: "xapp-1",
      SLACK_SIGNING_SECRET: "secret",
    });
    expect(creds.botToken).toBe("xoxb-1");
  });

  it("lists every missing variable in the error", () => {
    try {
      loadCredentials({});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCredentialsError);
      const missing = (err as MissingCredentialsError).missing;
      expect(missing).toEqual(["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"]);
    }
  });

  it("reports only the absent variable when others are present", () => {
    try {
      loadCredentials({ ...full, SLACK_APP_TOKEN: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as MissingCredentialsError).missing).toEqual(["SLACK_APP_TOKEN"]);
    }
  });
});

describe("claudeBin", () => {
  it("defaults to 'claude'", () => {
    expect(claudeBin({})).toBe("claude");
  });
  it("honors CLAUDE_CLI_BIN", () => {
    expect(claudeBin({ CLAUDE_CLI_BIN: "/usr/local/bin/claude" })).toBe("/usr/local/bin/claude");
  });
});
