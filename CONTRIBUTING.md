# Contributing

Thanks for considering a contribution to the Slack-Claude Bridge.

## Before you start

For anything beyond a small fix, please open an issue first to discuss the change — especially
anything that could touch scope. This project is deliberately **local-first** (see
[CLAUDE.md](CLAUDE.md) and [docs/prd.md](docs/prd.md)); proposals that push toward a hosted
service, relay, or coordinator are out of scope for V1 and will be redirected or declined.

## Setup

```bash
npm install
npm run dev      # run the bridge (tsx watch)
```

Requires Node.js ≥ 20 and the `claude` CLI on your `PATH` — see the [README](README.md#prerequisites)
for full setup.

## Before opening a PR

Run the full gate and make sure it's clean:

```bash
npm run verify   # typecheck + lint + test
```

- TypeScript strict, no unjustified `any`.
- Match the existing module layout under `src/` (see CLAUDE.md's repository layout).
- Add or update tests for behavior changes — `npm run test` should cover the new path.
- `npm run format` runs automatically on file edits via a hook if you're using Claude Code; otherwise
  run it manually before committing.
- Never commit secrets, tokens, or real Slack workspace/channel/user IDs — use synthetic fixtures in
  tests, as the existing suite does.

## Naming

Our local process is called **"the bridge"** in code, logs, docs, and commit messages — never
"agent" (that word is reserved for AI agents like Claude). See CLAUDE.md for the full rationale.

## Pull requests

- Keep PRs focused — one logical change per PR.
- Describe _why_, not just _what_, in the PR description.
- CI (`.github/workflows/ci.yml`) runs `npm run verify`, `npm run build`, and packs the npm
  tarball on every PR; it must pass before merge.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you're expected
to uphold it.
