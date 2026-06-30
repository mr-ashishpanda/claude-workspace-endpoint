/** Slack credentials, loaded exclusively from the environment (never logged). */
export interface SlackCredentials {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export class MissingCredentialsError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required Slack credentials: ${missing.join(", ")}. ` +
        `Set them in .env (see .env.example) or run \`slack-claude init\`.`,
    );
    this.name = "MissingCredentialsError";
  }
}

/**
 * Read Slack credentials from the environment. Throws MissingCredentialsError
 * listing every absent variable. Secrets are only ever read here — never
 * persisted to bridge storage and never logged.
 */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): SlackCredentials {
  const botToken = env.SLACK_BOT_TOKEN?.trim() ?? "";
  const appToken = env.SLACK_APP_TOKEN?.trim() ?? "";
  const signingSecret = env.SLACK_SIGNING_SECRET?.trim() ?? "";

  const missing: string[] = [];
  if (!botToken) missing.push("SLACK_BOT_TOKEN");
  if (!appToken) missing.push("SLACK_APP_TOKEN");
  if (!signingSecret) missing.push("SLACK_SIGNING_SECRET");
  if (missing.length > 0) throw new MissingCredentialsError(missing);

  return { botToken, appToken, signingSecret };
}

/** Path to the Claude Code CLI binary (defaults to "claude" on PATH). */
export function claudeBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CLI_BIN?.trim() || "claude";
}
