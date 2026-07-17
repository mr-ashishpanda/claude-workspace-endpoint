import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { waitForReady } from "./wait-for-ready.js";

describe("waitForReady", () => {
  it("resolves ok with the pid on a ready message", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 1000);
    child.emit("message", { type: "ready", pid: 4242 });
    await expect(promise).resolves.toEqual({ ok: true, pid: 4242 });
  });

  it("resolves not-ok with the message on an error report", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 1000);
    child.emit("message", { type: "error", message: "missing credentials" });
    await expect(promise).resolves.toEqual({ ok: false, message: "missing credentials" });
  });

  it("resolves not-ok when the child process errors to spawn", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 1000);
    child.emit("error", new Error("spawn ENOENT"));
    await expect(promise).resolves.toEqual({ ok: false, message: "spawn ENOENT" });
  });

  it("resolves not-ok when the child exits before reporting readiness", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 1000);
    child.emit("exit", 1);
    await expect(promise).resolves.toEqual({
      ok: false,
      message: "bridge process exited early (code 1)",
    });
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves not-ok on timeout when nothing happens", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 5000);
    vi.advanceTimersByTime(5000);
    await expect(promise).resolves.toEqual({
      ok: false,
      message: "timed out waiting for the bridge to start",
    });
  });

  it("ignores a late message after settling on timeout", async () => {
    const child = new EventEmitter();
    const promise = waitForReady(child, 5000);
    vi.advanceTimersByTime(5000);
    const result = await promise;
    // A late message shouldn't throw or change the already-settled result.
    expect(() => child.emit("message", { type: "ready", pid: 1 })).not.toThrow();
    expect(result).toEqual({ ok: false, message: "timed out waiting for the bridge to start" });
  });
});
