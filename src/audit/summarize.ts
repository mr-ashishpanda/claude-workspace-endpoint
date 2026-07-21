import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ProcessRunner, defaultProcessRunner, parseClaudeOutput } from "../claude/invoke.js";
import { TokenUsage } from "../config/types.js";

const SYSTEM = [
  "You write a 1-2 sentence audit summary of a Slack-to-Claude interaction.",
  "Say what the user asked and what was done. Be concise and factual.",
  "Never include credentials, API keys, tokens, or personal data — omit or redact them.",
].join(" ");

/**
 * Args for the lightweight summarizer call. Print mode, JSON output, Haiku.
 * Run in an isolated temp cwd (see {@link summarizeActivity}) so no project
 * CLAUDE.md / settings / MCP are discovered. No additional context-stripping
 * flags are added here — that is intentionally out of scope for this task.
 * Revisit if further context-leak vectors are found.
 */
export function buildSummaryArgs(): string[] {
  return ["-p", "--output-format", "json", "--model", "claude-haiku-4-5"];
}

export interface SummarizeDeps {
  bin: string;
  prompt: string;
  response: string;
  runner?: ProcessRunner;
  /** Override cwd (tests). Default: a fresh temp dir with no Claude project context. */
  cwd?: string;
}

export async function summarizeActivity(
  deps: SummarizeDeps,
): Promise<{ summary: string; tokens: TokenUsage }> {
  const runner = deps.runner ?? defaultProcessRunner;
  const createdCwd = deps.cwd === undefined;
  const cwd = deps.cwd ?? mkdtempSync(`${tmpdir()}/sum-`);
  const input = [
    SYSTEM,
    "",
    "USER REQUEST:",
    deps.prompt,
    "",
    "ASSISTANT RESPONSE:",
    deps.response,
    "",
    "Write the 1-2 sentence summary now.",
  ].join("\n");
  try {
    const { stdout, stderr, code } = await runner.run(deps.bin, buildSummaryArgs(), cwd, input);
    if (code !== 0) throw new Error(`summarizer claude exited with code ${code}: ${stderr}`);
    const parsed = parseClaudeOutput(stdout);
    return { summary: parsed.text.trim(), tokens: parsed.usage };
  } finally {
    if (createdCwd) rmSync(cwd, { recursive: true, force: true });
  }
}
