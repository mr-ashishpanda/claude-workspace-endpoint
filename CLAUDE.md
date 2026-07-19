# CLAUDE.md — Slack-Claude Bridge

Always-loaded operating core. Detailed procedures live in skills that load when relevant (see
**Skills & config** at the bottom). Authoritative spec: `docs/prd.md`.

## What this is

A **local-first** service that bridges Slack with Claude Code: it maps Slack channels/threads to
local workspace directories, invokes `claude` inside the mapped workspace when triggered, and
posts the response back to the right Slack location.

**Local-first** = no server-side components, relays, cloud services, or hosted control planes in
V1; everything runs as one local process. A task pushing toward a hosted service or coordinator is
out of scope (PRD "Out of Scope") — flag it.

**Terminology:** "**the bridge**" = our local process (`npm run dev`), never the AI assistant.
Reserve "agent"/"subagent" for AI agents. Use "the bridge" in code, logs, docs, and commits.

## Tech stack

- **Runtime**: Node.js ≥ 20, ESM, TypeScript (strict).
- **Slack**: `@slack/bolt` (Socket Mode — no public inbound endpoint).
- **CLI**: `slack-claude` (`init`, `map add|list|edit|remove`).
- **Persistence**: local files under `SLACK_CLAUDE_HOME` (default `.slack-claude/`).
- **Test**: vitest · **Lint**: eslint · **Format**: prettier.

## Repository layout

```
src/
  bridge.ts     wiring: Slack app + session store + Claude invocation
  index.ts      process entrypoint
  logger.ts, log-sink.ts   structured logging + log-file rotation
  cli/          slack-claude CLI commands (init, map add|list|edit|remove, run/stop/logs)
  slack/        Bolt app, event routing, channel validation, file download
  session/      session store + scope keys (channel_id, channel_id+thread_ts)
  claude/       Claude Code invocation per workspace
  config/       mappings + credentials + cross-platform paths
  daemon/       background run (pidfile, readiness wait)
docs/           prd.md (spec), AGENT-SETUP.md (agent/tool setup), slack-app-manifest.yml,
                dev/specs/ (internal design specs — not user-facing docs)
logs/           runtime logs (bridge.log) — gitignored
.claude/        Claude Code config: settings, hooks, skills
```

## Commands

| Goal                         | Command                                       |
| ---------------------------- | --------------------------------------------- |
| Type-check                   | `npm run typecheck`                           |
| Lint                         | `npm run lint`                                |
| Tests                        | `npm run test`                                |
| Full gate (type+lint+test)   | `npm run verify`                              |
| Format                       | `npm run format` (auto-runs on edit via hook) |
| Build                        | `npm run build`                               |
| Run the bridge (dev / built) | `npm run dev` / `npm start`                   |
| Tail bridge logs             | `npm run bridge:logs`                         |

First time: `npm install`.

## Conventions

- TypeScript strict; no unjustified `any`. ESM imports with extensions where NodeNext needs them.
- Small, single-purpose modules mirroring the `src/` layout.
- One logger that always prefixes the mapping identity.
- Secrets only via env (`.env`, gitignored). `.env` and lockfile edits are blocked by a hook —
  ask the user to make those edits.

## Operating rules (non-negotiable)

1. **Verify before "done".** Never mark a change complete without running, testing, and observing
   it. If no end-to-end way to test exists, build it (or ask for what only a human can provide).
   → load the **`verifying-work`** skill for the loop and the build-or-ask rule.
2. **Challenge assumptions.** If a request conflicts with the PRD, the local-first constraint, or
   good design, say so and ask before proceeding. Disagreement is welcome; silent wrong work isn't.
3. **Stay in scope.** The PRD "Out of Scope" list is binding for V1.
4. **Apply the Review checklist** (below) on every review. The built-in `/code-review` reads it
   from this file automatically; for a thorough guided pass use the `reviewing-changes` skill.
5. **Improve this config.** When you hit a recurring command, missing guardrail, or a gap in these
   files, update the relevant `.claude/` config, skill, or this file as part of the work — and note
   it in your summary. Keep it practical.

## Review checklist

Apply on every code review, in addition to the generic correctness/security/clarity pass. The
built-in `/code-review` reads these as project rules; `reviewing-changes` walks them in depth.

1. **Session & scope integrity** — channel scope keys on `channel_id`; thread scope on
   `channel_id + thread_ts`; replies post to the correct location; sessions reused per scope and
   persist across bridge restarts.
2. **Trigger correctness** — `mention` ignores non-mentions; `auto` handles every in-scope message;
   all four scope×trigger combinations consistent.
3. **Local-first scope** — no hosted service/relay/coordinator, no Slack command beyond
   `@claude status`, nothing else from PRD "Out of Scope".
4. **Secret safety** — no hardcoded tokens; credentials only from env; nothing secret logged.
5. **Identity** — mapping identity appears in Slack responses, logs, and status output.
6. **Naming** — our local process is "the bridge", not "agent".

## Skills & config

Load a skill when its topic comes up; don't inline its content here.

- **`verifying-work`** — required verification loop; build the test/integration path if missing,
  else ask for human input. Use before claiming any change done.
- **`run-bridge`** — start the bridge, confirm it connects, tail/inspect logs.
- **`reviewing-changes`** — guided, thorough review that walks the Review checklist with the
  domain reasoning behind it. Optional: bare `/code-review` already applies the checklist above.
- **`bridge-domain`** — mappings, session scopes, trigger modes, identity, status command.
  Load when touching session/scope/trigger logic.

Config files: `.claude/settings.json` (hooks + permissions + plugins),
`.claude/hooks/protect-paths.sh` (blocks `.env`/secret/lockfile edits),
`.claude/hooks/format.sh` (Prettier on edit).
MCP: the **Slack** server is available for inspecting channels/threads; consider **context7** for
live `@slack/bolt` docs.
