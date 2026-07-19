import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invokeClaude, ClaudeInvocationError } from "./invoke.js";

/**
 * Exercises the REAL defaultProcessRunner (actual child_process.spawn) against a
 * stub `claude` executable. Verifies the parts that only the OS process layer
 * proves: cwd is the workspace, the prompt is piped on stdin, `--resume` is
 * forwarded, JSON is parsed, and a non-zero exit raises ClaudeInvocationError.
 */
let dir: string;
let workspace: string;
let okBin: string;
let failBin: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scb-claude-"));
  workspace = join(dir, "workspace");
  mkdirSync(workspace);

  // Stub success: echoes back cwd, whether --resume was passed, and the stdin
  // prompt — inside the JSON envelope `claude --output-format json` produces.
  okBin = join(dir, "claude-ok");
  writeFileSync(
    okBin,
    `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const resume = process.argv.includes("--resume");
  const modelIdx = process.argv.indexOf("--model");
  const model = modelIdx >= 0 ? process.argv[modelIdx + 1] : "";
  const skip = process.argv.includes("--dangerously-skip-permissions");
  const out = {
    result:
      "cwd=" + process.cwd() + ";resume=" + resume + ";model=" + model + ";skip=" + skip +
      ";cfgdir=" + (process.env.CLAUDE_CONFIG_DIR || "") + ";prompt=" + input.trim(),
    session_id: "stub-session",
  };
  process.stdout.write(JSON.stringify(out));
});
`,
  );
  chmodSync(okBin, 0o755);

  // Stub failure: exits non-zero with a stderr message.
  failBin = join(dir, "claude-fail");
  writeFileSync(
    failBin,
    `#!/usr/bin/env node
process.stderr.write("stub failure");
process.exit(3);
`,
  );
  chmodSync(failBin, 0o755);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("invokeClaude with the real process runner", () => {
  it("runs in the workspace, pipes the prompt on stdin, parses JSON", async () => {
    const res = await invokeClaude({
      bin: okBin,
      workspace,
      prompt: "investigate the outage",
      resumeSessionId: null,
    });
    expect(res.sessionId).toBe("stub-session");
    // Compare via realpath: on macOS the spawned child reports its cwd already
    // resolved through the /var -> /private/var symlink, while `workspace` is not.
    expect(res.text).toContain(`cwd=${realpathSync(workspace)}`);
    expect(res.text).toContain("resume=false");
    expect(res.text).toContain("prompt=investigate the outage");
  });

  it("forwards --resume for an existing session", async () => {
    const res = await invokeClaude({
      bin: okBin,
      workspace,
      prompt: "follow up",
      resumeSessionId: "stub-session",
    });
    expect(res.text).toContain("resume=true");
  });

  it("forwards --model and --dangerously-skip-permissions through spawn", async () => {
    const res = await invokeClaude({
      bin: okBin,
      workspace,
      prompt: "check",
      resumeSessionId: null,
      model: "opus",
      skipPermissions: true,
    });
    expect(res.text).toContain("model=opus");
    expect(res.text).toContain("skip=true");
  });

  it("sets CLAUDE_CONFIG_DIR in the spawned process env when provided", async () => {
    const res = await invokeClaude({
      bin: okBin,
      workspace,
      prompt: "check",
      resumeSessionId: null,
      claudeConfigDir: "/home/me/.claude-custom",
    });
    expect(res.text).toContain("cfgdir=/home/me/.claude-custom");
  });

  it("raises ClaudeInvocationError on a non-zero exit", async () => {
    await expect(
      invokeClaude({ bin: failBin, workspace, prompt: "x", resumeSessionId: null }),
    ).rejects.toBeInstanceOf(ClaudeInvocationError);
  });
});
