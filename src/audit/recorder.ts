import { Logger } from "../logger.js";
import { AuditConfig, AuditRecord, MappingAuditOverride, TokenUsage } from "../config/types.js";
import { deriveSessionRef } from "./session-ref.js";

export interface ActivityInput {
  slackTs: string;
  user?: string;
  channel: string;
  threadTs?: string;
  identity: string;
  workspace: string;
  sessionId: string | null;
  claudeConfigDir?: string;
  durationMs: number;
  outcome: "success" | "error";
  error?: string;
  tokens: TokenUsage;
  prompt: string;
  response?: string;
  auditOverride?: MappingAuditOverride;
}

export interface AuditRecorderDeps {
  config: AuditConfig;
  store: { append(r: AuditRecord): void };
  logger: Logger;
  resolveUser?: (id: string) => Promise<string>;
  resolveChannel?: (id: string) => Promise<string>;
  summarize?: (a: {
    prompt: string;
    response: string;
  }) => Promise<{ summary: string; tokens: TokenUsage }>;
  now?: () => Date;
  genId?: () => string;
}

let counter = 0;
function defaultId(now: Date): string {
  counter = (counter + 1) % 1e6;
  return `aud_${now.getTime().toString(36)}_${counter.toString(36)}`;
}

/**
 * Writes audit records off the hot path. `record()` is fire-and-forget and
 * never throws; failures are logged with the mapping identity. `drain()` lets
 * tests await in-flight writes.
 */
export class AuditRecorder {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: AuditRecorderDeps) {}

  record(activity: ActivityInput): void {
    const p = this.write(activity)
      .catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.deps.logger.withIdentity(activity.identity).error(`audit write failed: ${m}`);
      })
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async write(a: ActivityInput): Promise<void> {
    const enabled = a.auditOverride?.enabled ?? this.deps.config.enabled;
    if (!enabled) return;
    const wantSummary =
      a.outcome === "success" &&
      a.response != null &&
      (a.auditOverride?.summary ?? this.deps.config.summary) &&
      this.deps.summarize != null;

    const now = (this.deps.now ?? (() => new Date()))();
    const [userName, channelName] = await Promise.all([
      a.user && this.deps.resolveUser
        ? this.deps.resolveUser(a.user)
        : Promise.resolve(a.user ?? null),
      this.deps.resolveChannel ? this.deps.resolveChannel(a.channel) : Promise.resolve(null),
    ]);

    let summary: string | null = null;
    let summaryTokens: TokenUsage | null = null;
    let summaryError: string | null = null;
    if (wantSummary) {
      try {
        const out = await this.deps.summarize!({ prompt: a.prompt, response: a.response! });
        summary = out.summary;
        summaryTokens = out.tokens;
      } catch (err) {
        summaryError = err instanceof Error ? err.message : String(err);
      }
    }

    const record: AuditRecord = {
      id: (this.deps.genId ?? (() => defaultId(now)))(),
      ts: now.toISOString(),
      slackTs: a.slackTs,
      durationMs: a.durationMs,
      user: a.user ?? null,
      userName: userName ?? null,
      channel: a.channel,
      channelName: channelName ?? null,
      threadTs: a.threadTs ?? null,
      identity: a.identity,
      workspace: a.workspace,
      sessionId: a.sessionId,
      sessionRef: deriveSessionRef({
        sessionId: a.sessionId,
        workspace: a.workspace,
        claudeConfigDir: a.claudeConfigDir,
      }),
      outcome: a.outcome,
      error: a.error ?? null,
      tokens: a.tokens,
      summaryTokens,
      summary,
      summaryError,
    };
    this.deps.store.append(record);
  }
}
