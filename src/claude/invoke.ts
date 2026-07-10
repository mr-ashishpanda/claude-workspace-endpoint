import { spawn } from "node:child_process";
import { ClaudeModel } from "../config/types.js";

/** Result of one Claude Code invocation. */
export interface ClaudeResult {
  /** The assistant's textual reply. */
  text: string;
  /** Claude Code session id for this conversation (for resuming). */
  sessionId: string | null;
}

/** Low-level process runner, injectable so tests can avoid spawning `claude`. */
export interface ProcessRunner {
  run(
    bin: string,
    args: string[],
    cwd: string,
    input: string,
    /** Environment for the child; undefined ⇒ inherit the parent process env. */
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

/** Per-mapping knobs that shape the `claude` invocation. */
export interface ClaudeArgOptions {
  /** Model family; `default` (or omitted) lets the CLI auto-pick the latest. */
  model?: ClaudeModel;
  /** Append `--dangerously-skip-permissions` when true. */
  skipPermissions?: boolean;
}

/**
 * Build the `claude` CLI argument list for a non-interactive invocation.
 *
 * The prompt is supplied on stdin (not argv) so arbitrary message text is safe.
 * `--output-format json` gives us the session id and result; `--resume` reuses
 * an existing Claude session so conversation state persists across messages.
 * `--model` selects a model family (CLI resolves the latest version); a
 * `default` family adds no flag. `--dangerously-skip-permissions` is opt-in.
 */
export function buildClaudeArgs(
  resumeSessionId: string | null,
  opts: ClaudeArgOptions = {},
): string[] {
  const args = ["-p", "--output-format", "json"];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (opts.model && opts.model !== "default") {
    args.push("--model", opts.model);
  }
  if (opts.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

/** Parse the JSON envelope `claude --output-format json` prints on stdout. */
export function parseClaudeOutput(stdout: string): ClaudeResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { text: "", sessionId: null };
  try {
    const parsed = JSON.parse(trimmed) as {
      result?: unknown;
      session_id?: unknown;
    };
    const text = typeof parsed.result === "string" ? parsed.result : trimmed;
    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
    return { text, sessionId };
  } catch {
    // Fall back to raw text if Claude didn't emit JSON (e.g. an error string).
    return { text: trimmed, sessionId: null };
  }
}

/** Default runner: spawns the real `claude` binary. */
export const defaultProcessRunner: ProcessRunner = {
  run(bin, args, cwd, input, env) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(bin, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        // undefined ⇒ child inherits this process's env (spawn default).
        ...(env ? { env } : {}),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolvePromise({ stdout, stderr, code }));
      child.stdin.write(input);
      child.stdin.end();
    });
  },
};

export interface InvokeOptions {
  bin: string;
  workspace: string;
  prompt: string;
  resumeSessionId: string | null;
  /** Model family for this invocation (`default`/omitted = CLI auto-picks). */
  model?: ClaudeModel;
  /** Pass `--dangerously-skip-permissions` for this invocation. */
  skipPermissions?: boolean;
  /** Custom `CLAUDE_CONFIG_DIR` for this invocation; omitted ⇒ inherit env. */
  claudeConfigDir?: string;
  runner?: ProcessRunner;
}

export class ClaudeInvocationError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "ClaudeInvocationError";
  }
}

/**
 * Invoke Claude Code inside `workspace`, feeding `prompt` on stdin. Resumes the
 * given Claude session id when present so the conversation continues.
 */
export async function invokeClaude(opts: InvokeOptions): Promise<ClaudeResult> {
  const runner = opts.runner ?? defaultProcessRunner;
  const args = buildClaudeArgs(opts.resumeSessionId, {
    model: opts.model,
    skipPermissions: opts.skipPermissions,
  });
  // Only override the child env when a custom config dir is set; otherwise
  // inherit (undefined) so the bridge's own environment flows through.
  const env = opts.claudeConfigDir
    ? { ...process.env, CLAUDE_CONFIG_DIR: opts.claudeConfigDir }
    : undefined;
  const { stdout, stderr, code } = await runner.run(
    opts.bin,
    args,
    opts.workspace,
    opts.prompt,
    env,
  );
  if (code !== 0) {
    throw new ClaudeInvocationError(`claude exited with code ${code}`, code, stderr);
  }
  return parseClaudeOutput(stdout);
}
