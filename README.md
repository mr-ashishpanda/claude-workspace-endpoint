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
- A Slack app with Socket Mode enabled. Create it from the ready-to-paste manifest at
  [docs/slack-app-manifest.yml](docs/slack-app-manifest.yml) — it sets exactly the scopes and event
  subscriptions the PRD requires (`channels:history`/`groups:history`, `channels:read`/`groups:read`,
  `chat:write`, `app_mentions:read`, `files:read`; events `message.channels`, `message.groups`,
  `app_mention`). The manifest's header lists the steps to obtain the bot token, app-level token, and
  signing secret.

## Install

Install the published package straight from GitHub (it builds itself on install), which puts the
`slack-claude` CLI on your `PATH`:

```bash
npm install -g github:mr-ashishpanda/claude-workspace-endpoint
slack-claude init
```

Or work from a clone:

```bash
npm install
npm run build
```

When installed globally, use `slack-claude <cmd>`; from a clone, use `node dist/cli/index.js <cmd>`.

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

`map add`/`map edit` also prompt for two per-mapping options:

- **Model family** — `default` (the CLI auto-picks the latest model), or `sonnet`/`opus`/`haiku`
  (latest of that family). Passed to `claude` as `--model`.
- **Skip permissions** — opt in (default off, with a warning) to run `claude` with
  `--dangerously-skip-permissions` for that workspace. Only for trusted workspaces.
- **Custom `CLAUDE_CONFIG_DIR`** — optionally point this mapping's `claude -p` runs at a separate
  Claude config directory (its own settings, MCP servers, and auth). Blank inherits the bridge
  process's environment; `~` is expanded.

Credentials live only in `.env` (gitignored). Mappings and sessions live as JSON under
`SLACK_CLAUDE_HOME` (default `.slack-claude/`). See `.env.example` for the full variable list.

## Images and sessions

- **Image uploads** — attach a PNG, JPEG, GIF, or WebP in a triggering Slack message and the bridge
  downloads it under `SLACK_CLAUDE_HOME/media/` and lets Claude view it. Other file types get a
  "not supported" reply and are skipped.
- **Resuming a session** — each answer is headed `identity | session-id`, so the resumable Claude
  session id is visible on every reply; `@claude status` also prints a ready-to-run
  `cd <workspace> && claude --resume <id>` command so you can continue the exact conversation
  locally. A stored session id is bound to the `CLAUDE_CONFIG_DIR` it was created under (Claude
  stores sessions per config dir); if that changes, the bridge starts a fresh session rather than
  failing a doomed resume.

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
