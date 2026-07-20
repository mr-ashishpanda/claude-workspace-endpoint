# Design: Slack sender prefix on messages to Claude

Date: 2026-07-20
Repo: `github.com/mr-ashishpanda/claude-workspace-endpoint`

## Goals

Per-mapping option to tag every prompt sent to Claude with a `[Slack: <sender>]`
marker, so a workspace's own `CLAUDE.md`/`slack.md` can detect the message came
through Slack and reply accordingly (e.g. Slack-formatted instead of GitHub-flavored
markdown). Complemented with reference templates users can adopt in their own mapped
workspace repos — the bridge does not write into workspace directories.

## 1. Mapping field + CLI

- `Mapping` (`src/config/types.ts`) gains `slackPrefix: boolean`.
- `validateMapping` defaults it to `false` when absent, so mappings written before
  this existed still load (same pattern as `model`/`skipPermissions`).
- `map add`/`map edit` prompt:
  `"Tag messages to Claude with the Slack sender, e.g. \"[Slack: jane.doe] ...\"?"`
  (confirm, default off).
- `map list` shows `slack tag: enabled/disabled`.
- The "Added/Updated mapping" summary line appends `, slack-prefix` when enabled
  (mirroring how `skip-permissions` is surfaced today).

## 2. Prefix format

Fixed format, not user-templatable: `[Slack: <name>] <original prompt>`. When the
prompt is empty (image-only message), the tag stands alone: `[Slack: <name>]`.

No separate enable/disable + wording knob — enable/disable is the only configuration
surface, per the approved design.

## 3. Username resolution

- `InboundMessage` (`src/slack/router.ts`) gains an optional `user?: string` (Slack
  user id), populated in `normalizeMessage` (`src/slack/app.ts`) from the raw event's
  `user` field.
- New `src/slack/user-lookup.ts`:
  - `UserLookupClient` interface (`users.info`), same injectable-client shape as
    `ChannelCheckClient` in `channel-check.ts`.
  - `UserResolver` class: `resolve(userId): Promise<string>` looks up
    `profile.display_name` → `real_name` → `name` → the raw id, in that preference
    order, and caches the result in memory for the process lifetime. A lookup that
    throws returns the raw id **without** caching the failure, so a transient API
    error self-heals on the next message instead of sticking for the bridge's uptime.
  - `createUserResolver(botToken, client = new WebClient(botToken))` factory.
- `bridge.ts` constructs one `UserResolver` alongside the existing `createFileDownloader`
  wiring and passes `resolveUser: (id) => resolver.resolve(id)` into the deps object.
- `HandlerDeps` (`src/slack/handler.ts`) gains an optional
  `resolveUser?: (userId: string) => Promise<string>`. Absent (e.g. unit tests) ⇒ the
  raw Slack user id is used as-is instead of a resolved name.

## 4. Where the prefix is applied

In `handleInbound`'s `runOneInvocation`, **after** the existing "nothing actionable"
check (`!rawPrompt.trim() && imagePaths.length === 0` ⇒ skip invocation). This
ordering matters: if the prefix were applied before that check, a file-only message
with only _unsupported_ attachments (text empty, no viewable images) would gain a
non-empty `[Slack: ...]` prompt and wrongly trigger a Claude invocation after the
"not supported" notice was already posted, instead of correctly skipping.

```
rawPrompt = decision.prompt ?? ""
if !rawPrompt.trim() && imagePaths.length === 0: skip (unchanged)
promptText = mapping.slackPrefix ? withSlackPrefix(rawPrompt, msg.user, deps.resolveUser) : rawPrompt
prompt = buildImagePrompt(promptText, imagePaths)   // unchanged; runs after prefixing
```

`withSlackPrefix` is a small helper (new `src/slack/slack-prefix.ts`):
resolves the label (`resolveUser(userId)` if both present, else the raw id, else
`"unknown"`), then prepends `[Slack: <label>]` (with a trailing space only when
`text` is non-empty).

## 5. Slack app manifest

`docs/slack-app-manifest.yml` gains the `users:read` bot scope (needed for
`users.info`), listed alongside the existing scopes with a one-line comment on its
purpose. No reinstall/migration note needed — this is a new installation with no
existing customers, so the manifest simply reflects the correct scope set going
forward.

## 6. Reference templates (docs/templates/, not auto-scaffolded)

Two new files in this repo, for a user to copy into their own mapped workspace repo
by hand — the bridge never writes into workspace directories:

- `docs/templates/slack.md` — reply rules for Slack-sourced messages: concise
  replies, Slack `mrkdwn` (`*bold*`, `_italic_`, `` `code` ``) instead of GitHub
  markdown, no tables/headers (they don't render in Slack), code blocks kept short
  or summarized with an offer to paste the rest.
- `docs/templates/claude-md-slack-snippet.md` — a short snippet (explicitly _not_ a
  drop-in `CLAUDE.md`) instructing: if an inbound message starts with a
  `[Slack: <name>]` tag, it came through the Slack-Claude bridge — load this
  workspace's `slack.md` (if present) and follow its rules for the reply. Named
  `claude-md-slack-snippet.md` (not `CLAUDE.md`) so it's unambiguous it's meant to be
  merged into an existing `CLAUDE.md`, not placed as-is.

## Testing / verification

- `mappings.test.ts`: `slackPrefix` defaults to `false` on load/validate for
  pre-existing mapping JSON without the field; round-trips when set via `add`/`edit`.
- New `user-lookup.test.ts`: cache hit avoids a second `users.info` call; a lookup
  failure falls back to the raw id and is not cached (a subsequent call retries the
  API).
- New `slack-prefix.test.ts` (or folded into `handler.test.ts`): prefix applied when
  `slackPrefix` is true and `resolveUser` is provided; raw Slack id used when
  `resolveUser` is absent; no prefix when the mapping has it disabled; empty-prompt
  image-only messages get the bare tag; unsupported-file-only messages still skip
  invocation entirely with the flag on (the ordering fix in section 4).
- Manual: `npm run verify`, then `slack-claude map add`/`map edit`/`map list` to
  confirm the new prompt and summary/list lines render correctly.

## Review-checklist alignment

- Session/scope integrity: no scope-key changes; the prefix only touches prompt text.
- Trigger correctness: prefixing happens after routing/gating decisions; doesn't
  change which messages trigger.
- Local-first: `users.info` is a direct Slack Web API call from the bridge process
  (same trust boundary as the existing `conversations.info` channel check and file
  download) — no new hosted component.
- Secret safety: bot token flows through the same credentials/env path as every
  other Slack API call; never logged.
- Identity: unaffected — this feature concerns the _inbound_ prompt, not identity-
  prefixed outbound replies.
- Naming: "the bridge" throughout; no `CLAUDE.md`/`slack.md` file is written into any
  workspace by the bridge itself.
