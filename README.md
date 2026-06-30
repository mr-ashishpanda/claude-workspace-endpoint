# Slack-Claude Bridge

A **local-first** service that bridges Slack with [Claude Code](https://claude.com/claude-code). It
maps Slack channels (and threads) to local workspace directories, invokes `claude` inside the mapped
workspace when triggered, and posts the reply back to the right Slack location.

No server-side components, relays, or hosted control planes — everything runs as one local process
(the **bridge**) over Slack Socket Mode.

## How it works

```
Slack workspace ──▶ Slack app (Socket Mode) ──▶ the bridge ──┬─ mapping A ─▶ claude in /repos/a
                                                             ├─ mapping B ─▶ claude in /repos/b
                                                             └─ …
```

Each **mapping** binds: a unique Claude **identity**, a Slack **channel**, a **workspace** directory,
a **session scope** (`channel` or `thread`), and a **trigger mode** (`mention` or `auto`).

| Session scope | Key                      | Reply posted        |
| ------------- | ------------------------ | ------------------- |
| `channel`     | `channel_id`             | directly to channel |
| `thread`      | `channel_id + thread_ts` | in-thread           |

| Trigger   | Behavior                                             |
| --------- | ---------------------------------------------------- |
| `mention` | invoked only on an explicit `@claude` mention        |
| `auto`    | invoked on every message within the configured scope |

Sessions persist to disk under `SLACK_CLAUDE_HOME` and are reused across messages and bridge
restarts.

## Prerequisites

- Node.js ≥ 20
- The `claude` CLI on your `PATH` (or set `CLAUDE_CLI_BIN`)
- A Slack app with Socket Mode enabled — see [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) and the
  permissions in [docs/prd.md](docs/prd.md). Required scopes include reading public/private channel
  history and metadata, posting messages, and receiving app-mention events; subscribe to
  `message.channels`, `message.groups`, and `app_mention`.

## Install

```bash
npm install
npm run build
```

## Configure

```bash
# Write Slack credentials + storage location to .env (interactive)
node dist/cli/index.js init

# Add channel→workspace mappings (interactive)
node dist/cli/index.js map add
node dist/cli/index.js map list
node dist/cli/index.js map edit <identity>
node dist/cli/index.js map remove <identity>
```

Credentials live only in `.env` (gitignored). Mappings and sessions live as JSON under
`SLACK_CLAUDE_HOME` (default `.slack-claude/`). See `.env.example` for the full variable list.

## Run

```bash
npm run dev     # tsx watch (development)
npm start       # node dist/index.js (built)
npm run bridge:logs   # tail logs/bridge.log
```

Invite the bot to a mapped channel, then message it. In a channel with `@claude status`, the bridge
replies with the mapping identity, workspace, scope, trigger, session id, messages processed, and
session start time.

## Develop

```bash
npm run verify   # typecheck + lint + test (the full gate)
npm run test     # vitest
npm run format   # prettier
```

See [CLAUDE.md](CLAUDE.md) for the operating rules and review checklist, and `docs/prd.md` for the
authoritative spec.
