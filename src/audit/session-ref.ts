import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Encode an absolute workspace path the way Claude Code names its project dir. */
function encodeProjectDir(workspace: string): string {
  return workspace.replace(/\//g, "-");
}

/**
 * Best-effort path to the full Claude transcript for a session, for audit
 * drill-down. Returns null when unknown (caller falls back to sessionId).
 */
export function deriveSessionRef(opts: {
  sessionId: string | null;
  workspace: string;
  claudeConfigDir?: string;
}): string | null {
  if (!opts.sessionId) return null;
  const base = opts.claudeConfigDir ?? join(homedir(), ".claude");
  const candidate = join(
    base,
    "projects",
    encodeProjectDir(opts.workspace),
    `${opts.sessionId}.jsonl`,
  );
  return existsSync(candidate) ? candidate : null;
}
