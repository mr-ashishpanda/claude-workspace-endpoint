# Agent Setup — Claude Code configuration for this repo

How this repository is configured so Claude Code can develop, run, test, and verify work
efficiently. This is an **overview**; the live config lives in `CLAUDE.md` and `.claude/`.

## Design model

Claude Code loads `CLAUDE.md` into context **every turn**, while **skills load on demand** when a
task matches their description. So the config is split accordingly:

- **`CLAUDE.md` (always on)** — lean, high-signal core: what the project is, tech stack, repo
  layout, commands, conventions, and short **non-negotiable operating rules** with pointers.
- **Skills (on demand)** — the verbose procedures, loaded only when relevant.

This keeps the always-on context small while detailed guidance is one hop away.

## What's configured

### CLAUDE.md

The always-loaded core. Notably defines:

- Project identity + the **local-first** constraint (no hosted components in V1).
- **Terminology**: "the bridge" = our local process; "agent" = AI agents only.
- Commands table (verification toolkit) and conventions.
- **Operating rules**: verify before done · challenge assumptions · stay in scope · self-improve
  this config.

### Skills (`.claude/skills/`)

| Skill               | Loads when                                  | Purpose                                                                                               |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `verifying-work`    | About to claim a change done/fixed/passing  | Run→test→observe loop; **build the test/integration path if missing, else ask for human-only inputs** |
| `run-bridge`        | Running the project / checking logs         | Start the bridge, confirm Slack connection, tail `logs/bridge.log`                                    |
| `reviewing-changes` | Want a deep guided review                   | Walks the Review checklist with domain reasoning                                                      |
| `bridge-domain`     | Touching session/scope/trigger/status logic | Domain reference (mappings, scopes, triggers, identity, status) so the PRD isn't re-read              |

**Code review**: the project Review checklist lives in `CLAUDE.md`, which the **built-in
`/code-review`** reads automatically — so running `/code-review` applies the project checks without
overriding it. `reviewing-changes` is the optional deep guided pass. No custom reviewer subagent
(avoids duplication).

### Hooks (`.claude/hooks/`, wired in `settings.json`)

- **`protect-paths.sh`** (PreToolUse) — blocks edits to `.env`, secret/key files, and lockfiles.
- **`format.sh`** (PostToolUse) — runs Prettier on edited JS/TS/JSON/MD; silently no-ops if
  Prettier isn't installed.

### Settings (`.claude/settings.json`)

- **Permissions allowlist** for safe dev commands (npm scripts, git read ops, file inspection) to
  reduce prompts; **deny** reads of `.env`/keys.
- **Hooks** registration (above).
- Enabled plugins.

### Toolchain scaffold (repo root)

`package.json` (scripts: `build`, `dev`, `typecheck`, `lint`, `format`, `test`, `verify`,
`bridge:logs`), `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`,
`.env.example`. This is the dev environment only — **no product features are implemented**.

### MCP servers

- **Slack** — available for inspecting channels/threads during development.
- **context7** (suggested) — live `@slack/bolt` docs.

## The verification contract (most important)

A change is **not done** until run, tested, and observed end-to-end. If no way to test it exists,
**building that path is part of the task**; only what genuinely needs a human (real Slack
credentials, a user-controlled channel) is escalated with a specific ask. See the `verifying-work`
skill. The `CLAUDE.md` operating rule keeps this present even when the skill isn't loaded.

## Human follow-ups

- Run `npm install` once so the format hook and `npm run verify` are active.
- Provide real Slack credentials in `.env` (copy from `.env.example`) for end-to-end Slack
  verification — Claude cannot create these.

## Reusing this setup elsewhere

The interactive **`setup-claude-workspace`** skill (personal/global) reproduces this whole
configuration from scratch in any project, asking for input where needed.
