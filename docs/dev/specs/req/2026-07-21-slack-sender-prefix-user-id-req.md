# Requirement: include the Slack user ID in the sender prefix

Date: 2026-07-21
Repo: `github.com/mr-ashishpanda/claude-workspace-endpoint`

The existing Slack sender-prefix feature tags each prompt sent to Claude with `[Slack: <sender>]`, where `<sender>` is only the human-readable name (display name / real name) resolved in `src/slack/user-lookup.ts`; the unique Slack user ID appears only as a fallback when the name lookup fails. Because display and real names are neither unique nor stable, the prefix must additionally carry the Slack user ID, which is unique and stable per workspace. Update the sender prefix so every request from Slack includes **both** the Slack user ID and the readable full name — e.g. `[Slack: Jane Doe (U012ABCDEF)]` — with the user ID always present even when the name resolves successfully. On lookup failure the tag should still degrade gracefully to the user ID alone.
