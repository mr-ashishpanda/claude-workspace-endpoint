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

Append-only record per completed Claude invocation routed through the
Slack-Claude bridge (who, where, cost). A \`claude\` session opened in \`audit/\`
is a **read-only query assistant**: answer questions by querying the files
below.

## Read-only guardrail

**Never modify, delete, rewrite, gzip, or otherwise touch any file under
\`audit/\`**, including this one. Compaction/rollup/pruning are done only by
\`slack-claude audit compact|rollup|prune\`, never by an interactive session —
for a retention request ("delete records older than a year"), tell the user
to run that CLI command instead.

## Partition layout

UTC-date-partitioned, 3 tiers, oldest data most compact:

\`\`\`
audit/
  CLAUDE.md                    ← this file
  2026/
    07/
      2026-07-21.jsonl         ← hot: recent, raw JSON Lines, append-only
      2026-07-20.jsonl.gz      ← warm: gzipped daily partition (still queryable)
    06.rollup.json             ← cold: monthly aggregate (per-user/channel totals)
\`\`\`

- **Hot** \`YYYY/MM/YYYY-MM-DD.jsonl\` — one JSON object per invocation, up to ~90d.
- **Warm** \`YYYY/MM/YYYY-MM-DD.jsonl.gz\` — same format; read with \`zcat\`/\`rg -z\`,
  never decompress to a new file (that's a write).
- **Cold** \`YYYY/MM.rollup.json\` — monthly aggregate (per-user/channel counts,
  token totals, first/last activity) from \`audit rollup --month\`. Prefer this
  for long-range questions — detail records may be pruned, rollups survive.

## \`AuditRecord\` schema

One JSON object per line:

| Field | Meaning |
| --- | --- |
| \`id\` | Correlation id (cross-references \`bridge.log\`). |
| \`ts\` | ISO timestamp the bridge processed the invocation. |
| \`slackTs\` | Originating Slack event \`ts\`. |
| \`durationMs\` | Invocation wall-clock duration. |
| \`user\` / \`userName\` | Slack user id / resolved display name (\`null\` if unknown). |
| \`channel\` / \`channelName\` | Slack channel id / resolved name, e.g. \`"#eng-backend"\`. |
| \`threadTs\` | Thread ts for thread-scoped invocations; \`null\` for channel scope. |
| \`identity\` | Mapping identity that handled it. |
| \`workspace\` | Absolute path to the workspace Claude ran in. |
| \`sessionId\` | Claude Code session id, if established. |
| \`sessionRef\` | Absolute path to the full transcript (see Drill-down). |
| \`outcome\` / \`error\` | \`"success"\`/\`"error"\`; error reason or \`null\`. |
| \`tokens\` | \`{ input, output }\` for the main invocation. |
| \`summaryTokens\` | Same, for the summarizer call, or \`null\`. |
| \`summary\` | 1–2 sentence summary of the request and outcome. |
| \`summaryError\` | Set if summarization failed after retry; else \`null\`. |

## Efficient scanning

1. **Narrow by date first** — open only the matching \`YYYY-MM-DD.jsonl[.gz]\`
   file(s); never glob every partition when the range is known.
2. **Prefer \`rg\`/\`jq\` over loading files into context** for search/filter/aggregate.
3. **Use rollups for long-range aggregates** ("last quarter", "this year")
   instead of scanning raw partitions.
4. **Never load a whole year at once** — process month/day-by-day and
   accumulate instead of concatenating everything into one command.

## Common recipes

User activity for a day:
\`\`\`sh
jq -c 'select(.user == "U0423")' audit/2026/07/2026-07-21.jsonl
\`\`\`

Channel activity across a month (hot + warm):
\`\`\`sh
for f in audit/2026/07/*.jsonl*; do
  ( [[ $f == *.gz ]] && zcat "$f" || cat "$f" ) | jq -c 'select(.channel == "C0001")'
done
\`\`\`

Token spend per user for a day:
\`\`\`sh
jq -s 'group_by(.userName) | map({user: .[0].userName,
  input: (map(.tokens.input) | add), output: (map(.tokens.output) | add)})' \\
  audit/2026/07/2026-07-21.jsonl
\`\`\`

Token spend per user across a month (from rollup, preferred):
\`\`\`sh
jq '.byUser' audit/2026/07.rollup.json
\`\`\`

Busiest workspace for a day:
\`\`\`sh
jq -s 'group_by(.workspace) | map({workspace: .[0].workspace, count: length}) |
  sort_by(-.count)' audit/2026/07/2026-07-21.jsonl
\`\`\`

## Drill-down: full transcript

A record is a summary. For the full prompt/tool calls/response, read
\`sessionRef\` — the absolute path to that invocation's transcript. If \`null\`,
look up the transcript by \`sessionId\` under the Claude config directory instead.

\`\`\`sh
cat "$(jq -r 'select(.id == "aud_abc123") | .sessionRef' audit/2026/07/2026-07-21.jsonl)"
\`\`\`

Reading a transcript is fine; still never write/move/delete anything, here or
at the transcript path.

## Detecting Slack-originated messages

A user message starting with \`[Slack: <name> (<id>)]\` arrived via the bridge,
not a terminal — apply the Slack reply rules below. The tag is metadata; don't
quote or comment on it. (Full convention:
\`docs/templates/claude-md-slack-snippet.md\`.) Only appears when the mapping's
Slack-sender-prefix option is enabled.

## Replying in Slack

- **Be concise** — leads get read on a phone; answer first, detail after.
- **Slack \`mrkdwn\`, not GFM**: \`*bold*\` (single asterisks), \`_italic_\`,
  inline \`code\`, \`<https://example.com|link text>\` (not \`[text](url)\`).
- **No tables/headers** — Slack renders \`#\` and table syntax as literal
  punctuation; use short bullet lists.
- **Short code blocks** — paste only the relevant lines; offer to send more
  rather than dumping a full file.
- **No nested/deeply indented lists** — flat lists or short prose only.
`;

/** Write (or overwrite) `audit/CLAUDE.md` under `home`, creating the dir as needed. */
export function writeAuditClaudeMd(home: string): void {
  const dir = auditDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), AUDIT_CLAUDE_MD);
}
