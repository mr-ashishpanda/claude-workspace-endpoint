---
name: reviewing-changes
description: Thorough, guided code review for the Slack-Claude Bridge — walks the project Review checklist (session/scope integrity, trigger correctness, local-first scope, secret safety, identity, naming) with the domain reasoning behind each check. Use for an in-depth review. The built-in /code-review already applies the same checklist from CLAUDE.md; load this when you want the guided deep pass.
---

# Reviewing Slack-Claude Bridge changes (guided deep pass)

This skill complements — it does **not** replace — the built-in `/code-review`. The Review
checklist also lives in `CLAUDE.md`, which `/code-review` reads automatically, so a quick review
via `/code-review` already applies these checks. Load this skill when you want a deeper, guided
walkthrough with the reasoning behind each item.

## Step 1 — Generic pass

Review the current diff (`git status` / `git diff`, including untracked files): correctness, edge
cases, error handling, security, clarity/naming, test/doc gaps. You may run `/code-review` for this.

## Step 2 — Project checklist (with reasoning)

1. **Session & scope integrity** — channel scope keys on `channel_id`; thread scope on
   `channel_id + thread_ts`. Replies post to the correct location (channel vs in-thread). Sessions
   are reused per scope and persist across bridge restarts. _Why: a wrong key collapses or leaks
   sessions across channels/threads; the wrong post target breaks the channel-vs-thread contract._
2. **Trigger correctness** — `mention` ignores non-mention messages; `auto` handles every in-scope
   message. All four scope×trigger combinations stay consistent. _Why: a leaky mention filter makes
   the bridge respond when it shouldn't; a missed auto message drops work silently._
3. **Local-first scope** — flag any hosted service, relay, coordinator, extra Slack command beyond
   `@claude status`, or other PRD "Out of Scope" item. _Why: V1 is strictly single-process local._
4. **Secret safety** — no hardcoded tokens; credentials only from env; nothing secret logged.
5. **Identity** — the mapping identity appears in Slack responses, logs, and status output.
6. **Naming** — our local process is "the bridge", not "agent" (see CLAUDE.md Terminology).

## Step 3 — Report

Separate **must-fix** (bugs, scope/security violations) from **nice-to-have** (style). If the change
is sound, say so plainly. See `bridge-domain` for the full model behind checks 1–2.
