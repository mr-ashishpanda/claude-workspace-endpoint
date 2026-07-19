# Security Policy

## Supported versions

This project is pre-1.0 (`0.x`). Only the latest release on `master` is supported with security
fixes.

## What's in scope

The bridge (this local process) handles Slack bot/app tokens and shells out to the `claude` CLI —
optionally with `--dangerously-skip-permissions` if a mapping opts in. Reports about token/secret
handling, credential storage under `SLACK_CLAUDE_HOME`, session-scope isolation, or command
invocation are all in scope.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Use GitHub's private reporting instead: go to the **Security** tab of this repository →
**Report a vulnerability**. If that's unavailable, contact the maintainer at
[mr-ashishpanda@users.noreply.github.com](mailto:mr-ashishpanda@users.noreply.github.com).

Include reproduction steps, the affected version/commit, and impact. Expect an initial response
within a few days; this is a solo-maintained open-source project run on a best-effort basis.
