import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { Prompter, PromptWriter } from "./prompt.js";

/** A piped (non-TTY) input stream carrying the given lines, then EOF. */
function pipedInput(lines: string[]): Readable {
  return Readable.from([lines.map((l) => l + "\n").join("")]);
}

function sink(): PromptWriter & { text: string } {
  return {
    text: "",
    write(t: string) {
      this.text += t;
    },
  };
}

describe("Prompter over piped input", () => {
  it("resolves multiple sequential prompts from one piped stream (regression)", async () => {
    // Reproduces the original bug: readline/promises only answered the first
    // question on a non-TTY stream. The queue-based Prompter must answer all.
    const p = new Prompter(pipedInput(["alice", "C123", "/repos/x"]), sink());
    expect(await p.ask("Name")).toBe("alice");
    expect(await p.ask("Channel")).toBe("C123");
    expect(await p.ask("Workspace")).toBe("/repos/x");
    p.close();
  });

  it("choose() reads enumerated answers in sequence", async () => {
    const p = new Prompter(pipedInput(["thread", "auto"]), sink());
    expect(await p.choose("Scope", ["channel", "thread"] as const)).toBe("thread");
    expect(await p.choose("Trigger", ["mention", "auto"] as const)).toBe("auto");
    p.close();
  });

  it("falls back to the default on an empty line / EOF", async () => {
    const p = new Prompter(pipedInput([""]), sink());
    expect(await p.ask("Storage", ".slack-claude")).toBe(".slack-claude");
    // Stream is now at EOF; further asks still resolve to the default.
    expect(await p.ask("Bin", "claude")).toBe("claude");
    p.close();
  });

  it("confirm() is true only for y/yes", async () => {
    const p = new Prompter(pipedInput(["y", "n", "yes"]), sink());
    expect(await p.confirm("ok?")).toBe(true);
    expect(await p.confirm("ok?")).toBe(false);
    expect(await p.confirm("ok?")).toBe(true);
    p.close();
  });

  it("confirm() honors an explicit default on an empty line", async () => {
    const p = new Prompter(pipedInput(["", ""]), sink());
    // Empty answer keeps the given default rather than always falling to false.
    expect(await p.confirm("keep?", true)).toBe(true);
    expect(await p.confirm("keep?", false)).toBe(false);
    p.close();
  });

  it("choose() throws on an invalid choice at EOF with no default", async () => {
    const p = new Prompter(pipedInput(["bogus"]), sink());
    await expect(p.choose("Scope", ["channel", "thread"] as const)).rejects.toThrow(
      /Expected one of/,
    );
    p.close();
  });
});
