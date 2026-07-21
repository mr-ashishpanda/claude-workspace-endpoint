import { describe, it, expect } from "vitest";
import { buildSummaryArgs, summarizeActivity } from "./summarize.js";

describe("summarizeActivity", () => {
  it("builds a haiku, json, print-mode arg list", () => {
    const args = buildSummaryArgs();
    expect(args).toContain("-p");
    expect(args).toEqual(
      expect.arrayContaining(["--output-format", "json", "--model", "claude-haiku-4-5"]),
    );
  });

  it("runs the summarizer and returns summary + tokens", async () => {
    let seen: { args: string[]; cwd: string; input: string } | null = null;
    const runner = {
      run: async (_bin: string, args: string[], cwd: string, input: string) => {
        seen = { args, cwd, input };
        return {
          stdout: JSON.stringify({
            result: "Ann asked X; the bridge did Y.",
            usage: { input_tokens: 40, output_tokens: 12 },
          }),
          stderr: "",
          code: 0,
        };
      },
    };
    const out = await summarizeActivity({
      bin: "claude",
      prompt: "why fail?",
      response: "because Z",
      runner,
    });
    expect(out.summary).toBe("Ann asked X; the bridge did Y.");
    expect(out.tokens).toEqual({ input: 40, output: 12 });
    expect(seen!.input).toContain("why fail?");
    expect(seen!.input).toContain("because Z");
    expect(seen!.cwd).not.toContain("audit"); // never runs inside audit/
  });

  it("throws on non-zero exit", async () => {
    const runner = { run: async () => ({ stdout: "", stderr: "boom", code: 1 }) };
    await expect(
      summarizeActivity({ bin: "claude", prompt: "p", response: "r", runner }),
    ).rejects.toThrow();
  });
});
