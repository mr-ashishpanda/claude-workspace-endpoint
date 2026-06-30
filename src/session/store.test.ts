import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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

  it("increments processed count", () => {
    const store = SessionStore.load(home);
    store.getOrCreate("C1", "id", fixedNow);
    store.incrementProcessed("C1");
    store.incrementProcessed("C1");
    expect(store.get("C1")?.messagesProcessed).toBe(2);
  });
});
