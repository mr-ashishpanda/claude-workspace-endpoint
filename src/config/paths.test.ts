import { describe, it, expect } from "vitest";
import { isAbsolute, join } from "node:path";
import { resolveHome, mappingsPath, sessionsPath, mediaDir } from "./paths.js";

describe("resolveHome", () => {
  it("defaults to an absolute .slack-claude path", () => {
    const home = resolveHome({});
    expect(isAbsolute(home)).toBe(true);
    expect(home.endsWith(".slack-claude")).toBe(true);
  });

  it("honors SLACK_CLAUDE_HOME and resolves it to absolute", () => {
    const home = resolveHome({ SLACK_CLAUDE_HOME: "/var/lib/scb" });
    expect(home).toBe("/var/lib/scb");
  });

  it("ignores a blank override", () => {
    expect(resolveHome({ SLACK_CLAUDE_HOME: "   " }).endsWith(".slack-claude")).toBe(true);
  });
});

describe("mappingsPath / sessionsPath", () => {
  it("place files inside the home directory", () => {
    expect(mappingsPath("/home/x")).toBe(join("/home/x", "mappings.json"));
    expect(sessionsPath("/home/x")).toBe(join("/home/x", "sessions.json"));
  });
});

describe("mediaDir", () => {
  it("places downloaded media under <home>/media", () => {
    expect(mediaDir("/home/x")).toBe(join("/home/x", "media"));
  });
});
