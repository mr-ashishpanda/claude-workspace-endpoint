---
name: bridge-domain
description: Domain model reference for the Slack-Claude Bridge — mappings, session scopes (channel vs thread), trigger modes (mention vs auto), Claude identity, persistence, and the @claude status command. Load when implementing or reviewing session, scope, trigger, routing, or status logic so you don't re-derive it from the PRD.
---

# Bridge domain model

Condensed from `docs/prd.md`; load this instead of re-reading the full spec for routine work.

## Mapping

A mapping = **identity + Slack channel + workspace dir + session scope + trigger mode**. Multiple
mappings are configured via the `slack-claude map` CLI.

## Identity

Unique per mapping. Must appear in **every** Slack response, log line, and `@claude status` output,
e.g. `[auth-investigator]`.

## Session scope

- **channel** — key = `channel_id`. One session per channel; replies posted directly to the
  channel (not as thread replies).
- **thread** — key = `channel_id + thread_ts`. One session per thread; replies posted in-thread.

First triggering message creates the session; subsequent in-scope messages reuse it.

## Trigger mode

- **mention** — invoked only on an explicit `@claude` mention; other messages ignored.
- **auto** — invoked for every message within the configured scope.

All four scope×trigger combinations (channel/thread × mention/auto) must work.

## Persistence

Sessions persist across messages and **survive bridge restarts** (local file persistence under
`SLACK_CLAUDE_HOME`).

## `@claude status` (the only V1 Slack command)

Returns: identity, workspace directory, session scope, trigger mode, session id, messages
processed, and session creation timestamp.

## Invocation

The bridge runs `claude` **inside the mapped workspace directory** (e.g. `cd <workspace> && claude`)
so Claude Code operates with that repo's own `CLAUDE.md` and context.
