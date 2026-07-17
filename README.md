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

If the repo is public and your `PATH` already has git access to GitHub, install straight from the
source (it builds itself on install), which puts the `slack-claude` CLI on your `PATH`:

```bash
npm install -g github:mr-ashishpanda/claude-workspace-endpoint
slack-claude init
```

**Private repo / no git access on the target machine** — every push to `master` or `v*` tag runs
CI, which builds, verifies, and packs the npm tarball. On a `v*` tag it also attaches that tarball
to a GitHub Release, so you can fetch the latest published build with the [GitHub CLI](https://cli.github.com/)
(`gh auth login` once) and a fixed command — no repo clone or SSH key needed on the target machine:

```bash
gh release download --repo mr-ashishpanda/claude-workspace-endpoint \
  --pattern '*.tgz' -D /tmp/slack-claude-pkg
npm install -g /tmp/slack-claude-pkg/*.tgz
slack-claude init
```

`gh release download` with no tag argument always grabs the **latest** release, so this command
stays the same across versions.

Or work from a clone:

```bash
npm install
npm run build
```

When installed globally, use `slack-claude <cmd>` from any directory; from a clone, use
`node dist/cli/index.js <cmd>` (or the `npm run` scripts below).

## Configure

```bash
# Write Slack credentials + storage location to your per-user config (interactive)
slack-claude init

# Add channel→workspace mappings (interactive)
slack-claude map add
slack-claude map list
slack-claude map edit <identity>
slack-claude map remove <identity>
```

When credentials are configured, `map add`/`map edit` verify the channel id live against Slack
(the bot can see it and is a member) before saving — a typo'd, wrong, or un-invited channel is
caught immediately, with a chance to fix it and retry, instead of silently dropping every future
Slack event for that mapping.

`map add`/`map edit` also prompt for two per-mapping options:

- **Model family** — `default` (the CLI auto-picks the latest model), or `sonnet`/`opus`/`haiku`
  (latest of that family). Passed to `claude` as `--model`.
- **Skip permissions** — opt in (default off, with a warning) to run `claude` with
  `--dangerously-skip-permissions` for that workspace. Only for trusted workspaces.
- **Custom `CLAUDE_CONFIG_DIR`** — optionally point this mapping's `claude -p` runs at a separate
  Claude config directory (its own settings, MCP servers, and auth). Blank inherits the bridge
  process's environment; `~` is expanded.

### Where things live

Installed as a CLI, the bridge stores everything in per-user directories, so it behaves the same
no matter which directory you launch it from (no `.env` in the current directory required):

| Purpose                     | Linux (XDG)                         | macOS                                         | Windows                             |
| --------------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------------- |
| Credentials (`.env`)        | `~/.config/slack-claude/`           | `~/Library/Application Support/slack-claude/` | `%APPDATA%\slack-claude\Config\`    |
| Mappings + sessions + media | `~/.local/state/slack-claude/`      | `~/Library/Application Support/slack-claude/` | `%LOCALAPPDATA%\slack-claude\Data\` |
| Log file                    | `~/.local/state/slack-claude/logs/` | `~/Library/Logs/slack-claude/`                | `%LOCALAPPDATA%\slack-claude\Log\`  |

The log file rotates automatically once it passes `LOG_MAX_SIZE` (default 5 MiB), keeping
`LOG_MAX_FILES` archives (default 5) as `bridge.log.1 … .N`, so on-disk history stays bounded.

Overrides: `SLACK_CLAUDE_HOME` relocates the storage root and `LOG_FILE` the log file. Any real
environment variable, or a project-local `.env` (handy when developing from a clone), takes
precedence over the per-user config `.env`. See `.env.example` for the full variable list.
Credentials are only ever read from the environment and never logged or written to bridge storage.

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

Installed as a CLI:

```bash
slack-claude run      # start the bridge in the background (alias: slack-claude start)
slack-claude stop     # stop the background bridge
slack-claude logs     # print the recent bridge log
slack-claude logs -f  # follow the log (cross-platform; no `tail` needed)
```

`slack-claude run` starts the bridge detached from the current shell: it waits until the bridge
has connected to Slack (or reports why it couldn't), prints the result, and exits — the bridge
keeps running under its own pid, independent of the terminal, until `slack-claude stop` or the
machine restarts. A pidfile at `SLACK_CLAUDE_HOME/bridge.pid` tracks it; running `slack-claude run`
again while one is already active just reports its pid instead of starting a second instance.

From a clone (development):

```bash
npm run dev           # tsx watch
npm start             # node dist/index.js (built)
npm run bridge:logs   # follow the log via the CLI
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
