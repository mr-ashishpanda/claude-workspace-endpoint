import { describe, it, expect } from "vitest";
import {
  buildClaudeArgs,
  parseClaudeOutput,
  invokeClaude,
  ClaudeInvocationError,
  ProcessRunner,
} from "./invoke.js";

describe("buildClaudeArgs", () => {
  it("builds non-interactive JSON args for a fresh session", () => {
    expect(buildClaudeArgs(null)).toEqual(["-p", "--output-format", "json"]);
  });
  it("adds --resume for an existing session", () => {
    expect(buildClaudeArgs("sess_1")).toEqual([
      "-p",
      "--output-format",
      "json",
      "--resume",
      "sess_1",
    ]);
  });
  it("adds --model for a non-default model family", () => {
    expect(buildClaudeArgs(null, { model: "opus" })).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "opus",
    ]);
  });
  it("omits --model for the default family", () => {
    expect(buildClaudeArgs(null, { model: "default" })).toEqual(["-p", "--output-format", "json"]);
  });
  it("adds --dangerously-skip-permissions when requested", () => {
    expect(buildClaudeArgs(null, { skipPermissions: true })).toEqual([
      "-p",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ]);
  });
  it("combines resume, model, and skip-permissions", () => {
    expect(buildClaudeArgs("sess_1", { model: "sonnet", skipPermissions: true })).toEqual([
      "-p",
      "--output-format",
      "json",
      "--resume",
      "sess_1",
      "--model",
      "sonnet",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("parseClaudeOutput", () => {
  it("extracts result + session_id from JSON", () => {
    const out = parseClaudeOutput(JSON.stringify({ result: "hi", session_id: "s1" }));
    expect(out).toEqual({ text: "hi", sessionId: "s1" });
  });
  it("falls back to raw text on non-JSON output", () => {
    expect(parseClaudeOutput("plain text")).toEqual({ text: "plain text", sessionId: null });
  });
  it("handles empty output", () => {
    expect(parseClaudeOutput("   ")).toEqual({ text: "", sessionId: null });
  });
});

describe("invokeClaude", () => {
  const fakeRunner = (
    result: { stdout: string; stderr: string; code: number | null },
    captured: {
      args?: string[];
      cwd?: string;
      input?: string;
      env?: NodeJS.ProcessEnv;
    } = {},
  ): ProcessRunner => ({
    async run(_bin, args, cwd, input, env) {
      captured.args = args;
      captured.cwd = cwd;
      captured.input = input;
      captured.env = env;
      return result;
    },
  });

  it("runs in the workspace, feeds the prompt on stdin, returns parsed result", async () => {
    const captured: { args?: string[]; cwd?: string; input?: string } = {};
    const runner = fakeRunner(
      { stdout: JSON.stringify({ result: "done", session_id: "s9" }), stderr: "", code: 0 },
      captured,
    );
    const res = await invokeClaude({
      bin: "claude",
      workspace: "/repos/auth",
      prompt: "investigate",
      resumeSessionId: null,
      runner,
    });
    expect(res).toEqual({ text: "done", sessionId: "s9" });
    expect(captured.cwd).toBe("/repos/auth");
    expect(captured.input).toBe("investigate");
  });

  it("forwards model and skipPermissions to the process args", async () => {
    const captured: { args?: string[] } = {};
    const runner = fakeRunner(
      { stdout: JSON.stringify({ result: "ok", session_id: "s1" }), stderr: "", code: 0 },
      captured,
    );
    await invokeClaude({
      bin: "claude",
      workspace: "/x",
      prompt: "p",
      resumeSessionId: null,
      model: "opus",
      skipPermissions: true,
      runner,
    });
    expect(captured.args).toContain("--model");
    expect(captured.args).toContain("opus");
    expect(captured.args).toContain("--dangerously-skip-permissions");
  });

  it("passes CLAUDE_CONFIG_DIR in the env when claudeConfigDir is set", async () => {
    const captured: { env?: NodeJS.ProcessEnv } = {};
    const runner = fakeRunner(
      { stdout: JSON.stringify({ result: "ok", session_id: "s1" }), stderr: "", code: 0 },
      captured,
    );
    await invokeClaude({
      bin: "claude",
      workspace: "/x",
      prompt: "p",
      resumeSessionId: null,
      claudeConfigDir: "/home/me/.claude-custom",
      runner,
    });
    expect(captured.env?.CLAUDE_CONFIG_DIR).toBe("/home/me/.claude-custom");
  });

  it("leaves env undefined when no claudeConfigDir is set (inherit)", async () => {
    const captured: { env?: NodeJS.ProcessEnv } = {};
    const runner = fakeRunner(
      { stdout: JSON.stringify({ result: "ok", session_id: "s1" }), stderr: "", code: 0 },
      captured,
    );
    await invokeClaude({
      bin: "claude",
      workspace: "/x",
      prompt: "p",
      resumeSessionId: null,
      runner,
    });
    expect(captured.env).toBeUndefined();
  });

  it("throws ClaudeInvocationError on a non-zero exit", async () => {
    const runner = fakeRunner({ stdout: "", stderr: "boom", code: 1 });
    await expect(
      invokeClaude({ bin: "claude", workspace: "/x", prompt: "p", resumeSessionId: null, runner }),
    ).rejects.toBeInstanceOf(ClaudeInvocationError);
  });
});
