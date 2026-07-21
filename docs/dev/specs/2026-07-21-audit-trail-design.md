# Design: Audit trail of Claude invocations

Date: 2026-07-21
Repo: `github.com/mr-ashishpanda/claude-workspace-endpoint`

## Goals

A short, per-activity audit trail of "who did what" through the bridge, keyed by
Slack user. Each Claude invocation produces one append-only record capturing the
actor (id + resolved name), the channel, the mapping identity, the target workspace,
the outcome, token usage, and a 1–2 sentence Claude-generated summary of what the
user asked and what the bridge did. Records are time-partitioned for bounded growth
and long-term retention, queryable via a read-only CLI, and the storage directory is
self-describing so a `claude` session opened inside it can answer audit questions
directly.

Local-first is preserved: no hosted relay/coordinator/service. The only outbound call
is the summarizer, which runs through the user's existing `claude` CLI (no new API key,
no Anthropic SDK).

## Non-goals

- No always-on background reaper — retention maintenance is explicit CLI.
- No secret/PII redaction pass beyond what the summarizer is instructed to omit
  (per the approved design, masking is folded into the summarizer prompt).
- The bridge never writes into a mapped workspace directory; the only new directory it
  writes is its own `audit/` root under `SLACK_CLAUDE_HOME`.

## 1. Storage & partitioning

New `audit/` root under `SLACK_CLAUDE_HOME` (new `auditDir(home)` / `auditPartitionPath(home, date)`
helpers in `src/config/paths.ts`, mirroring the existing `sessionsPath`/`mappingsPath`).

```
audit/
  CLAUDE.md                    ← self-describing query guide (§9)
  2026/
    07/
      2026-07-21.jsonl         ← hot: today, raw, append-only
      2026-07-20.jsonl.gz      ← warm: gzipped daily partition
    06.rollup.json             ← cold: monthly aggregate
```

- **Writer** appends one JSON line to the current day's partition
  (`audit/YYYY/MM/YYYY-MM-DD.jsonl`), created lazily. Append-only — never rewritten
  (contrast the full-rewrite `SessionStore`/`MappingStore`). Year/month directories
  keep any single directory small.
- **Read tolerance**: malformed lines are skipped, not fatal (mirrors the `.corrupt`
  quarantine spirit of `SessionStore.load`).
- **Three retention tiers** so growth stays bounded:
  - **Hot** (default ≤ 90 days): raw `.jsonl`.
  - **Warm**: gzipped daily partitions (`.jsonl.gz`), ~10× smaller, still readable via
    `zcat`/`rg -z`.
  - **Cold**: optional per-month `MM.rollup.json` aggregate (per-user and per-channel
    counts, token totals, first/last activity) so long-range analytics survive even
    after raw detail is pruned.
- **Maintenance is explicit CLI, never automatic** (local-first + audit integrity):
  - `audit compact --older-than 90d` — gzip old daily partitions.
  - `audit rollup --month YYYY-MM` — write/refresh the monthly aggregate.
  - `audit prune --older-than 3y --yes` — delete raw partitions past retention (keeps
    rollups; requires explicit confirmation).

## 2. Record schema

One record per completed invocation:

```jsonc
{
  "id": "aud_...", // correlation id, also emitted in bridge.log for cross-ref
  "ts": "2026-07-21T14:03:00.000Z", // bridge processing time (ISO)
  "slackTs": "1721...", // originating Slack event ts
  "durationMs": 12300,
  "user": "U0423",
  "userName": "Ashish Panda",
  "channel": "C0001",
  "channelName": "#eng-backend",
  "threadTs": null, // null for channel scope
  "identity": "auth-investigator", // mapping identity
  "workspace": "/Users/…/repo",
  "sessionId": "abc123", // Claude session id
  "sessionRef": "/Users/…/.claude/projects/…/abc123.jsonl", // path to full transcript (see §8 risk)
  "outcome": "success", // success | failure | error
  "error": null, // reason string when outcome ≠ success
  "tokens": { "input": 24110, "output": 1830 }, // main invocation
  "summaryTokens": { "input": 640, "output": 48 }, // summarizer call (null if summary off/failed)
  "summary": "Ashish asked why the login retry loop was failing; the bridge traced it to an unbounded backoff and proposed a fix.",
  "summaryError": null, // set when the summarizer failed after retry
}
```

Types live in `src/config/types.ts` (`AuditRecord`). Ids and names are both stored:
ids for stability/uniqueness, names for human readability of the trail.

## 3. Capture hook

In `handleInbound`'s `runOneInvocation` (`src/slack/handler.ts`) — the single place a
routed message becomes real work. The invocation is timed (start before invoke,
end after) and the deterministic fields (`user`, `channel`, `threadTs`, `identity`,
`workspace`, `sessionId`, `outcome`/`error`, `durationMs`, `tokens`) are captured there.

Crucially, **nothing audit-related runs on the user-facing hot path beyond capturing
these already-in-hand values**: name resolution, the summarizer call, and the file
append all happen **after the reply is posted**, in a fire-and-forget audit step. A
failure in the audit path is logged (with the mapping identity) and never affects the
Slack reply.

The status-command branch and ignored/denied messages are **not** audited (scope:
Claude invocations only, per the approved design).

## 4. Token usage extraction

`ClaudeResult` (`src/claude/invoke.ts`) gains `usage: { input: number; output: number }`.
`parseClaudeOutput` is extended to read the `usage` fields from the `claude
--output-format json` envelope (currently discarded — it keeps only `result` and
`session_id`). Both the main invocation and the summarizer call are parsed the same
way, populating `tokens` and `summaryTokens` respectively. Missing/`undefined` usage
degrades to `{ input: 0, output: 0 }` rather than throwing.

## 5. Name resolution

- **User name** reuses the existing `UserResolver` (`src/slack/user-lookup.ts`,
  `users.info`, `users:read`) and its in-process cache.
- **Channel name** needs a new resolver: `src/slack/channel-lookup.ts` with a
  `ChannelResolver` mirroring `UserResolver` (`conversations.info` →
  `#<name>`; falls back to the raw channel id; failures not cached). This requires the
  **`channels:read`** (+ **`groups:read`** for private channels) bot scope.
- Both run in the async audit step (post-reply), so the extra API calls cost the user
  no latency. `bridge.ts` constructs the `ChannelResolver` alongside the existing
  `UserResolver` wiring and passes it into the audit writer's deps.

## 6. Summarizer (via `claude` CLI, no SDK / no API key)

A new stripped invocation variant (separate from `buildClaudeArgs`, e.g.
`buildSummaryArgs` in `src/claude/`), run through the same `claude` binary so it uses
whatever auth the user's `claude` already has:

- `claude -p --output-format json --model claude-haiku-4-5`, prompt on stdin =
  the user's request text + Claude's response text, asking for a 1–2 sentence audit
  summary. System/append prompt instructs: _"Summarize in 1–2 sentences what the user
  asked and what was done. Never include credentials, tokens, API keys, or PII —
  omit or redact them."_ (masking folded in here, per the approved design).
- **Context stripped as far as the CLI allows**: run in an **isolated temp cwd** with
  project/user settings, `CLAUDE.md`, MCP, and tools disabled via flags, so it is a
  lightweight call rather than the full Claude Code harness.
- **Must not run inside `audit/`** — otherwise it would load the audit `CLAUDE.md` (§9)
  and try to _query_ logs instead of summarizing. The isolated temp cwd + settings-off
  flags guarantees this.
- The summarizer path is **not itself audited** (no recursion / no self-noise) — the
  capture hook lives only in the Slack invocation handler.
- On failure, retried once; if still failing, the record is written with
  `summary: null` + `summaryError` and `summaryTokens: null`.

> Implementation note: the exact context-stripping flags depend on the installed
> `claude` version and will be confirmed against `claude-code-guide` during
> implementation rather than assumed here.

## 7. Configuration (global default + per-map override; split toggle)

Only the **summary** costs tokens; recording metadata is free. The config reflects that
split, and the info note appears at the toggle.

- **Global** (`src/config`, e.g. an `audit` block in the global config file):
  - `audit.enabled: boolean` — master switch for recording audit records at all.
    Default **false** (opt-in).
  - `audit.summary: boolean` — whether to generate the Claude summary (the only
    token-costing part). Default **false**. Only meaningful when `enabled` is true.
  - `audit.retention` (optional) — `compactAfterDays` / `pruneAfterDays` defaults used
    by the maintenance commands (§1).
  - Prompted in `slack-claude init`, with the info note:
    _"Enable audit summaries? Note: summaries invoke Claude and consume tokens."_
- **Per-map override** — `Mapping` (`src/config/types.ts`) gains an optional
  `audit?: { enabled?: boolean; summary?: boolean }`. Any field present overrides the
  global for that mapping; absent ⇒ inherit. `validateMapping` defaults it to absent so
  pre-existing mappings load unchanged (same pattern as `slackPrefix`/`model`).
  Prompted in `map add`/`map edit` (confirm, default = inherit); shown in `map list`.
- **Effective resolution** per invocation:
  - `record  = mapping.audit?.enabled ?? global.audit.enabled`
  - `summarize = record && (mapping.audit?.summary ?? global.audit.summary)`

  When `record` is false, the capture hook is a no-op. When `record` is true but
  `summarize` is false, the record is written immediately (no async summarizer wait)
  with `summary: null`, `summaryTokens: null`, `summaryError: null`.

## 8. Access CLI — `slack-claude audit`

Read-only, partition-aware, mirrors `src/cli/logs.ts` structure (new `src/cli/audit.ts`,
plus an `else if (cmd === "audit")` branch and usage line in `src/cli/index.ts`).

- Query: `audit [--user X] [--channel Y] [--identity Z] [--since D] [--until D]`.
  Narrows by date → partition path **before** scanning; transparently reads `.jsonl`
  and `.jsonl.gz`. Default output = human one-liners (id → name already stored);
  `--json` / `--csv` for file export.
- Maintenance subcommands: `audit compact` / `audit rollup` / `audit prune` (§1).

> `sessionRef` risk: storing the transcript path assumes the Claude transcript location
> is derivable at write time. If it turns out not to be reliably knowable, the fallback
> is to store `sessionId` + `claudeConfigDir` (both already on `SessionRecord`) and let
> the audit `CLAUDE.md` explain the lookup. To be resolved in the plan.

## 9. `audit/CLAUDE.md` — self-describing query guide

Written into `audit/` (by `init`, or lazily on first write) so that opening a `claude`
session there turns the directory into an audit assistant. It documents:

- The **partition layout** and the three tiers — where to look, how to read `.gz`
  (`rg -z` / `zcat`) and `MM.rollup.json`.
- The **record schema** (every field's meaning, from §2).
- **Efficient scanning**: narrow by date → open only the relevant `YYYY/MM/` partitions
  first; use `rg`/`jq`; use rollups for long-range aggregate questions instead of
  scanning raw partitions; never load whole years.
- **Common question recipes**: activity for a user, in a channel, on a date; token spend
  per user; busiest workspace.
- **Drill-down**: take an event's `sessionRef` (or `sessionId` + config dir) and read the
  full Claude transcript for complete detail on what actually happened in that
  invocation.
- **Read-only guardrail**: analyze; never modify, delete, or rewrite audit files.

This file is a bridge-owned artifact in the bridge's own `audit/` directory — not a
write into any mapped workspace, so it stays within the "bridge never writes into
workspaces" rule.

## 10. Slack app manifest

`docs/slack-app-manifest.yml` gains `channels:read` (and `groups:read` for private
channels) with a one-line comment noting they're for audit channel-name resolution,
alongside the existing scopes. New installation, so no reinstall/migration note.

## Data flow (end to end)

1. Inbound message routed → invocation runs (unchanged); reply posted (unchanged).
2. If `record` is false → done.
3. Capture deterministic fields (already in hand): actor id, channel id, thread, identity,
   workspace, sessionId, outcome, durationMs, `tokens` (from extended `parseClaudeOutput`).
4. Async, post-reply: resolve user + channel names (cached); if `summarize`, run the
   stripped Haiku summarizer (prompt + response) and capture `summary` + `summaryTokens`.
5. Append one complete JSON line to today's partition. On summarizer failure after one
   retry, append with `summary: null` + `summaryError`.

## Error handling

- Audit-path failures (resolution, summarizer, file append) are logged with the mapping
  identity and swallowed — they never affect the Slack reply or the main invocation.
- Corrupt/partial lines are skipped on read.
- Missing usage in the JSON envelope degrades to zeros, not an exception.

## Testing / verification

- `paths.test.ts`: partition path derivation for a given date (year/month tree).
- New `audit-store.test.ts`: append writes one well-formed line to the correct daily
  partition; read tolerates a malformed line; reader merges `.jsonl` + `.jsonl.gz`.
- `invoke.test.ts`: `parseClaudeOutput` extracts `usage`; missing usage ⇒ zeros.
- New `channel-lookup.test.ts`: cache hit avoids a second `conversations.info`; failure
  falls back to the raw id and is not cached (mirrors `user-lookup.test.ts`).
- `mappings.test.ts`: `audit` override defaults to absent on load; round-trips via
  `add`/`edit`; effective-resolution table (global × per-map) computes correctly.
- Config: global `audit.enabled`/`audit.summary` default false; `record`/`summarize`
  resolution honored in the handler (no record when disabled; no summarizer call when
  `summarize` false; record still written).
- Summarizer: runs in an isolated cwd (not `audit/`); a failing summarizer yields a
  record with `summaryError` set and the reply still posts.
- CLI: `audit` query filters by user/channel/date and reads across hot+warm tiers;
  `compact`/`prune` behave and `prune` requires `--yes`.
- Manual (`verifying-work` / `run-bridge`): enable audit, send a mention through a mapped
  channel, confirm a record lands in the day's partition with names + tokens + summary;
  open a `claude` session in `audit/` and confirm the `CLAUDE.md` lets it answer a
  "who did what" question and drill into a `sessionRef`.

## Review-checklist alignment

- **Session/scope integrity**: no scope-key changes; audit reads scope/session fields
  read-only and records the correct `sessionId` per scope.
- **Trigger correctness**: capture hook fires only for actual invocations, after
  routing/gating; status and ignored messages are not audited.
- **Local-first**: storage is local files under `SLACK_CLAUDE_HOME`; the summarizer runs
  through the user's existing `claude` CLI (same trust boundary the bridge already uses);
  name resolution is direct Slack Web API (same boundary as the existing channel check).
  No hosted relay/coordinator, no new Slack command.
- **Secret safety**: no new secrets required (no API key); summarizer instructed to omit
  credentials/PII; audit records and logs never contain tokens/secrets. `audit/` inherits
  `SLACK_CLAUDE_HOME` locality.
- **Identity**: mapping identity is a first-class field on every record and prefixes any
  audit log lines (same one-logger convention).
- **Naming**: "the bridge" throughout; `audit/CLAUDE.md` is written only into the bridge's
  own `audit/` directory, never into a mapped workspace.

## Open questions / risks

1. **`sessionRef` derivability** (§8) — confirm the transcript path is knowable at write
   time; else fall back to `sessionId` + `claudeConfigDir`.
2. **Exact `claude` context-stripping flags** (§6) — verify against the installed CLI via
   `claude-code-guide` during implementation.
3. **Rollup timing** — rollups are generated on demand via `audit rollup`; whether `compact`
   should auto-refresh the affected month's rollup is a plan-time detail.
