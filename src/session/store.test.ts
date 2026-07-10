import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "./store.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scb-sess-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const fixedNow = () => new Date("2026-06-29T14:10:00Z");

describe("SessionStore", () => {
  it("creates a session once and reuses it", () => {
    const store = SessionStore.load(home);
    const a = store.getOrCreate("C1", "id", fixedNow);
    const b = store.getOrCreate("C1", "id", fixedNow);
    expect(a).toBe(b);
    expect(a.createdAt).toBe("2026-06-29T14:10:00.000Z");
    expect(a.messagesProcessed).toBe(0);
  });

  it("persists sessions across reloads (survives restart)", () => {
    const store = SessionStore.load(home);
    store.getOrCreate("C1:99.0", "id", fixedNow);
    store.setClaudeSessionId("C1:99.0", "sess_12345");
    store.incrementProcessed("C1:99.0");

    const reloaded = SessionStore.load(home);
    const rec = reloaded.get("C1:99.0");
    expect(rec?.claudeSessionId).toBe("sess_12345");
    expect(rec?.messagesProcessed).toBe(1);
    expect(rec?.createdAt).toBe("2026-06-29T14:10:00.000Z");
  });

  it("recovers from a corrupt sessions file instead of crashing (quarantines it)", () => {
    // Simulate a partially-written / tampered file from a crash mid-write.
    const file = join(home, "sessions.json");
    writeFileSync(file, "{ this is not valid json");
    const store = SessionStore.load(home); // must not throw
    expect(store.all()).toEqual([]);
    expect(existsSync(file + ".corrupt")).toBe(true);
    // The recovered store is usable and persists normally afterwards.
    store.getOrCreate("C1", "id", fixedNow);
    expect(SessionStore.load(home).get("C1")).toBeDefined();
  });

  it("treats a non-array sessions file as corrupt", () => {
    const file = join(home, "sessions.json");
    writeFileSync(file, JSON.stringify({ not: "an array" }));
    expect(SessionStore.load(home).all()).toEqual([]);
    expect(existsSync(file + ".corrupt")).toBe(true);
  });

  it("records the config dir alongside the claude session id", () => {
    const store = SessionStore.load(home);
    store.getOrCreate("C1", "id", fixedNow);
    store.setClaudeSessionId("C1", "sess_1", "/home/me/.claude-custom");
    expect(store.get("C1")?.claudeConfigDir).toBe("/home/me/.claude-custom");
    // Persists across reload.
    expect(SessionStore.load(home).get("C1")?.claudeConfigDir).toBe("/home/me/.claude-custom");
  });

  it("stores no config dir when the default was used", () => {
    const store = SessionStore.load(home);
    store.getOrCreate("C1", "id", fixedNow);
    store.setClaudeSessionId("C1", "sess_1");
    expect(store.get("C1")?.claudeConfigDir).toBeUndefined();
  });

  it("increments processed count", () => {
    const store = SessionStore.load(home);
    store.getOrCreate("C1", "id", fixedNow);
    store.incrementProcessed("C1");
    store.incrementProcessed("C1");
    expect(store.get("C1")?.messagesProcessed).toBe(2);
  });
});
