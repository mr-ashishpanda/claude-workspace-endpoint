# Slack reply rules

Copy this file into your mapped workspace repo (e.g. as `slack.md` at the repo
root) if you enable the bridge's Slack-sender-prefix option. It's referenced from
`CLAUDE.md` — see `claude-md-slack-snippet.md` in this same directory for the
snippet to add there.

When a message came from Slack (see the CLAUDE.md snippet for how to detect this),
reply differently than you would for a normal terminal session:

- **Be concise.** Slack messages are read on a phone as often as a desktop. Lead
  with the answer; put supporting detail after.
- **Use Slack `mrkdwn`, not GitHub-flavored markdown:**
  - Bold: `*bold*` (single asterisks, not double).
  - Italic: `_italic_`.
  - Inline code: `` `code` ``.
  - Links: `<https://example.com|link text>`, not `[link text](https://example.com)`.
- **Avoid tables and headers.** Slack doesn't render markdown tables or `#`
  headers — they show up as literal punctuation. Use short bullet lists instead.
- **Keep code blocks short.** Paste only the relevant few lines inside a fenced
  code block; for anything longer, summarize the change and offer to paste more on
  request rather than dumping a full file.
- **No nested/deeply indented lists.** Slack's rendering of nested bullets is
  unreliable — prefer a flat list, or short prose.
