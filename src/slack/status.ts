import { Mapping, SessionRecord } from "../config/types.js";

/** Prefix every Slack reply / log line with the mapping identity. */
export function identityPrefix(identity: string): string {
  return `[${identity}]`;
}

/** Format a Date as `YYYY-MM-DD HH:MM UTC` for status output. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

const SCOPE_LABEL = { channel: "Channel", thread: "Thread" } as const;
const TRIGGER_LABEL = { mention: "Mention", auto: "Auto" } as const;

/**
 * Render the `@claude status` reply for a mapping + its (maybe-not-yet-created)
 * session. Includes identity, workspace, scope, trigger, session id, messages
 * processed, and creation timestamp (PRD: Slack Commands → @claude status).
 */
export function formatStatus(mapping: Mapping, session: SessionRecord | undefined): string {
  const claudeSessionId = session?.claudeSessionId ?? null;
  const sessionId = claudeSessionId ?? "(not started)";
  const processed = session?.messagesProcessed ?? 0;
  const started = session ? formatUtc(session.createdAt) : "(not started)";

  const lines = [
    identityPrefix(mapping.identity),
    "",
    `Identity: ${mapping.identity}`,
    "",
    "Workspace:",
    mapping.workspace,
    "",
    "Session Scope:",
    SCOPE_LABEL[mapping.scope],
    "",
    "Trigger Mode:",
    TRIGGER_LABEL[mapping.trigger],
    "",
    "Session ID:",
    sessionId,
    "",
    `Messages Processed:`,
    String(processed),
    "",
    "Started:",
    started,
  ];

  // Once a Claude session id exists, show how to continue that exact
  // conversation locally — the headless session is otherwise "hidden".
  if (claudeSessionId) {
    lines.push("", "Resume:", `cd ${mapping.workspace} && claude --resume ${claudeSessionId}`);
  }

  return lines.join("\n");
}

/** Prefix arbitrary reply text with the mapping identity tag. */
export function withIdentity(identity: string, text: string): string {
  return `${identityPrefix(identity)}\n\n${text}`;
}

/**
 * A one-time footer, in small (italic) text, shown on the first reply of a
 * session. Surfaces the identity + Claude session id so a human can resume the
 * otherwise-hidden headless session (`@claude status` shows the full command).
 */
export function sessionStartedFooter(identity: string, claudeSessionId: string): string {
  return `_${identity} | ${claudeSessionId}_`;
}
