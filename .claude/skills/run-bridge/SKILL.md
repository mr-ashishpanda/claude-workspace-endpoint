---
name: run-bridge
description: Start the Slack-Claude Bridge (the local process that connects Slack to Claude Code), confirm it boots and connects to Slack, and tail its logs to verify behavior. Use when you need to run the project, check that a change works end-to-end, or inspect runtime output. "The bridge" = our local process, not the AI agent reviewing code.
---

# Run & verify the bridge

Use this to actually run the project and observe its output — the core of verifying your own
work. Do not claim a change works at runtime without doing this. Throughout, **"the bridge"**
means the local Slack-Claude Bridge process (`npm run dev`), never the AI assistant.

## 1. Preconditions

```bash
test -f .env || echo "MISSING .env — copy .env.example and ask the user to fill credentials"
npm install            # if node_modules is absent
```

The bridge needs valid `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` in `.env`.
If they are missing, you cannot fully verify Slack behavior — say so explicitly.

## 2. Static gate first

```bash
npm run verify        # typecheck + lint + test
```

Fix failures before running. There is no point booting code that doesn't compile.

## 3. Start the bridge

```bash
mkdir -p logs
npm run dev           # tsx watch; hot-reloads on change
# or, for a built artifact:
npm run build && npm start
```

Run it in the background (or a separate shell) so you can inspect logs while it runs.

## 4. Observe output — what "working" looks like

Tail the log and confirm the expected sequence:

```bash
npm run bridge:logs    # tail -f logs/bridge.log
```

Look for, in order:

- Slack Socket Mode connection established.
- Event received for a mapped channel/thread.
- Workspace routed (correct directory for the mapping).
- Claude Code invoked inside that workspace.
- Response posted back to the correct location (channel vs thread per scope).
- Every line prefixed with the mapping **identity**.

## 5. Integration check

Where feasible, exercise the real path: send a message in a dev channel (or feed a mock event)
and confirm:

- `mention` mappings ignore non-mention messages; `auto` mappings respond to every in-scope one.
- Channel-scope replies land in the channel; thread-scope replies stay in-thread.
- `@claude status` returns identity, workspace, scope, trigger, session id, messages processed,
  and start time.

## 6. Report

Quote the actual log lines / command output that prove the behavior. If you could not verify a
step (e.g. no credentials, no dev channel), state which step and why — never imply success.
