# CLAUDE.md snippet: detecting Slack-originated messages

This is **not** a drop-in `CLAUDE.md` file — it's a section to merge into the
`CLAUDE.md` already at the root of your mapped workspace repo. It pairs with
`slack.md` in this same directory (copy that one in as-is) and with the bridge's
per-mapping "Tag messages to Claude with the Slack sender" option
(`slack-claude map add` / `map edit`).

Add a section like this to your workspace's `CLAUDE.md`:

    ## Messages from Slack

    If an inbound user message starts with a `[Slack: <name>]` tag, it arrived
    through the Slack-Claude bridge, not a local terminal session. Load `slack.md`
    at the repo root and follow its reply rules for this response — Slack
    `mrkdwn` formatting, concise replies, no tables/headers.

    The `[Slack: <name>]` tag itself is metadata, not part of the user's actual
    request — don't quote it back or comment on it in your reply.

The tag only appears when the mapping routing this channel/thread has the
Slack-sender-prefix option enabled; workspaces mapped without it never see the tag,
so this section is a no-op for them.
