import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditDir } from "../config/paths.js";

/**
 * Self-describing query guide written into `audit/CLAUDE.md`. When a user opens
 * a `claude` session inside the bridge's `audit/` directory, this file turns
 * that session into a read-only audit-query assistant: it documents the
 * partition layout, the `AuditRecord` schema, efficient-scanning rules, common
 * recipes, and how to drill into a full transcript via `sessionRef`.
 */
export const AUDIT_CLAUDE_MD = `# Audit trail — query guide

This directory is the bridge's audit trail: one append-only record per completed
Claude invocation routed through the Slack-Claude bridge, capturing who did what,
where, and what it cost. You are reading this because a \`claude\` session was
opened inside \`audit/\` — treat this as your job description: **answer questions
about the audit trail by querying the files below.**

## Read-only guardrail

This directory is **read-only for you**. Analyze, search, and summarize — but
**never modify, delete, rewrite, gzip, or otherwise touch any file under \`audit/\`**,
including this one. Compaction, rollups, and pruning are handled exclusively by
the bridge's own \`slack-claude audit compact|rollup|prune\` maintenance commands,
never by an interactive session. If a question requires changing retention (e.g.
"delete records older than a year"), tell the user to run the CLI command instead
of doing it yourself.

## Partition layout

Records are time-partitioned by UTC date into three tiers, oldest data becoming
more compact over time:

\`\`\`
audit/
  CLAUDE.md                    ← this file
  2026/
    07/
      2026-07-21.jsonl         ← hot: today/recent, raw JSON Lines, append-only
      2026-07-20.jsonl.gz      ← warm: gzipped daily partition (still queryable)
    06.rollup.json             ← cold: monthly aggregate (per-user/per-channel totals)
\`\`\`

- **Hot** — \`audit/YYYY/MM/YYYY-MM-DD.jsonl\`. One JSON object per line, one line
  per invocation. Most recent history (default up to ~90 days).
- **Warm** — \`audit/YYYY/MM/YYYY-MM-DD.jsonl.gz\`. Same format, gzip-compressed
  by the \`audit compact\` command. Read directly with \`zcat\` or \`rg -z\` —
  never decompress to a new file (that would be a write).
- **Cold** — \`audit/YYYY/MM.rollup.json\`. A monthly aggregate (per-user counts,
  per-channel counts, token totals, first/last activity timestamps) written by
  \`audit rollup --month YYYY-MM\`. Use this for long-range questions instead of
  scanning raw partitions — the detail records may have been pruned but the
  rollup survives.

## The \`AuditRecord\` schema

Each line in a \`.jsonl\`/\`.jsonl.gz\` file is one JSON object with these fields:

| Field           | Meaning                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| \`id\`            | Correlation id for this record (also appears in \`bridge.log\` for cross-reference). |
| \`ts\`             | ISO timestamp of when the bridge processed the invocation.                       |
| \`slackTs\`        | The originating Slack event's \`ts\` (message timestamp).                          |
| \`durationMs\`     | Wall-clock duration of the Claude invocation, in milliseconds.                    |
| \`user\`           | Slack user id of the requester (\`null\` if unknown).                              |
| \`userName\`       | Resolved display name for \`user\` (\`null\` if resolution failed).                  |
| \`channel\`        | Slack channel id the message came from.                                          |
| \`channelName\`    | Resolved channel name, e.g. \`"#eng-backend"\` (\`null\` if resolution failed).      |
| \`threadTs\`       | Thread timestamp for thread-scoped invocations; \`null\` for channel scope.         |
| \`identity\`       | The mapping identity that handled the invocation.                                 |
| \`workspace\`      | Absolute path to the local workspace directory Claude ran in.                    |
| \`sessionId\`      | Claude Code session id for this invocation, if established.                      |
| \`sessionRef\`     | Absolute path to the full Claude transcript for this invocation (see Drill-down). |
| \`outcome\`        | \`"success"\` or \`"error"\`.                                                        |
| \`error\`          | Reason string when \`outcome\` is not \`"success"\`; otherwise \`null\`.               |
| \`tokens\`         | \`{ input, output }\` token counts for the main invocation.                        |
| \`summaryTokens\`  | \`{ input, output }\` for the summarizer call, or \`null\` if summaries are off/failed. |
| \`summary\`        | 1–2 sentence Claude-generated summary of what the user asked and what was done.  |
| \`summaryError\`   | Set when the summarizer failed after retry; otherwise \`null\`.                     |

## Efficient scanning

Raw partitions can add up over months of activity — always narrow before you scan:

1. **Narrow by date first.** If the question mentions a date, week, or "today",
   open only the matching \`audit/YYYY/MM/YYYY-MM-DD.jsonl[.gz]\` file(s) — never
   glob every partition when the range is known.
2. **Prefer \`rg\` and \`jq\` over loading files into context.** These files are
   JSON Lines; \`rg\` searches raw text fast, \`jq\` filters/aggregates structured
   fields without you reading every line yourself.
3. **Use rollups for long-range aggregate questions** ("how many invocations did
   we do last quarter", "total tokens this year") instead of scanning raw
   partitions — read the relevant \`MM.rollup.json\` files instead.
4. **Never load a whole year at once.** If a question truly spans a wide range
   with no rollup available, process month-by-month or day-by-day and
   accumulate results rather than concatenating everything into one command.

## Common recipes

Activity by a specific user on a given day:

\`\`\`sh
jq -c 'select(.user == "U0423")' audit/2026/07/2026-07-21.jsonl
\`\`\`

Activity in a specific channel across a month (including gzipped days):

\`\`\`sh
rg -z --json '"channel":"C0001"' audit/2026/07/*.jsonl* | jq -c '.data.lines.text' 2>/dev/null
# or, simpler:
for f in audit/2026/07/*.jsonl*; do
  ( [[ $f == *.gz ]] && zcat "$f" || cat "$f" ) | jq -c 'select(.channel == "C0001")'
done
\`\`\`

Everything that happened on one date (mixing hot/warm transparently):

\`\`\`sh
f=audit/2026/07/2026-07-20.jsonl
[[ -f "$f.gz" ]] && zcat "$f.gz" | jq -c '.' || jq -c '.' "$f"
\`\`\`

Token spend per user for a day:

\`\`\`sh
jq -s 'group_by(.userName) | map({user: .[0].userName,
  input: (map(.tokens.input) | add), output: (map(.tokens.output) | add)})' \\
  audit/2026/07/2026-07-21.jsonl
\`\`\`

Token spend per user across a month, from the rollup (preferred over scanning
raw partitions):

\`\`\`sh
jq '.byUser' audit/2026/07.rollup.json
\`\`\`

Busiest workspace on a given day:

\`\`\`sh
jq -s 'group_by(.workspace) | map({workspace: .[0].workspace, count: length}) |
  sort_by(-.count)' audit/2026/07/2026-07-21.jsonl
\`\`\`

## Drill-down: full transcript detail

An audit record is a summary, not the whole story. To see exactly what happened
in one invocation — the full prompt, tool calls, and response — read the file at
that record's \`sessionRef\`: it is the absolute path to the complete Claude
transcript (JSONL) for that session.

If \`sessionRef\` is \`null\` (older records, or a case where the path could not be
derived), fall back to looking up the transcript by \`sessionId\` under the
relevant Claude config directory instead.

\`\`\`sh
# find the record, then read its transcript
jq -c 'select(.id == "aud_abc123")' audit/2026/07/2026-07-21.jsonl
cat "$(jq -r 'select(.id == "aud_abc123") | .sessionRef' audit/2026/07/2026-07-21.jsonl)"
\`\`\`

Remember: reading a \`sessionRef\` transcript is fine, but this stays a read-only
directory — never write, move, or delete anything, here or at the transcript path.

## Detecting Slack-originated messages

If an inbound user message starts with a \`[Slack: <name> (<id>)]\` tag, it arrived
through the Slack-Claude bridge, not a local terminal session — apply the Slack
reply rules below for that response. The tag itself is metadata, not part of the
user's actual request — don't quote it back or comment on it in your reply. (See
\`docs/templates/claude-md-slack-snippet.md\` for the full convention.) The tag only
appears when the mapping routing this channel/thread has the Slack-sender-prefix
option enabled — a query session opened from a local terminal never sees it.

## Replying in Slack

When replying to a Slack-originated message, follow these formatting rules:

- **Be concise.** Slack messages are read on a phone as often as a desktop. Lead
  with the answer; put supporting detail after.
- **Use Slack \`mrkdwn\`, not GitHub-flavored markdown:**
  - Bold: \`*bold*\` (single asterisks, not double).
  - Italic: \`_italic_\`.
  - Inline code: \`\`code\`\`.
  - Links: \`<https://example.com|link text>\`, not \`[link text](https://example.com)\`.
- **Avoid tables and headers.** Slack doesn't render markdown tables or \`#\`
  headers — they show up as literal punctuation. Use short bullet lists instead.
- **Keep code blocks short.** Paste only the relevant few lines inside a fenced
  code block; for anything longer, summarize the change and offer to paste more on
  request rather than dumping a full file.
- **No nested/deeply indented lists.** Slack's rendering of nested bullets is
  unreliable — prefer a flat list, or short prose.
`;

/** Write (or overwrite) `audit/CLAUDE.md` under `home`, creating the dir as needed. */
export function writeAuditClaudeMd(home: string): void {
  const dir = auditDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), AUDIT_CLAUDE_MD);
}
