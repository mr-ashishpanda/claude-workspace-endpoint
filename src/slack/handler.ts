import { Logger } from "../logger.js";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { KeyedSerializer } from "../session/serializer.js";
import { ClaudeResult, ProcessRunner, invokeClaude } from "../claude/invoke.js";
import { InboundMessage, route } from "./router.js";
import { formatStatus, withIdentity } from "./status.js";

/** Posts a reply to Slack. `threadTs` undefined ⇒ post to the channel root. */
export type Poster = (channel: string, text: string, threadTs: string | undefined) => Promise<void>;

export interface HandlerDeps {
  mappings: MappingStore;
  sessions: SessionStore;
  logger: Logger;
  claudeBin: string;
  post: Poster;
  /**
   * Serializes invocations per session key so concurrent message delivery for
   * the same scope reuses one Claude session. Optional: when absent (tests),
   * invocations run inline.
   */
  serializer?: KeyedSerializer;
  /** Optional runner override (tests inject a fake to avoid spawning claude). */
  runner?: ProcessRunner;
  /** Override the Claude invocation entirely (tests). */
  invoke?: (args: {
    bin: string;
    workspace: string;
    prompt: string;
    resumeSessionId: string | null;
    runner?: ProcessRunner;
  }) => Promise<ClaudeResult>;
}

/**
 * Process one inbound Slack message against every mapping bound to its channel.
 * This is the integration core, kept free of Bolt types so it is unit-testable.
 */
export async function handleInbound(deps: HandlerDeps, msg: InboundMessage): Promise<void> {
  const invoke = deps.invoke ?? invokeClaude;
  const mappings = deps.mappings.forChannel(msg.channel);

  for (const mapping of mappings) {
    const log = deps.logger.withIdentity(mapping.identity);
    const decision = route(mapping, msg);
    if (decision.action === "ignore") continue;

    const key = decision.sessionKey!;

    if (decision.action === "status") {
      const session = deps.sessions.get(key);
      log.info(`status requested for session ${key}`);
      await deps.post(msg.channel, formatStatus(mapping, session), decision.replyThreadTs);
      continue;
    }

    // action === "invoke". Serialize per session key so concurrent delivery
    // to the same scope reuses one Claude session (reads the resume id only
    // after any in-flight invocation for this key has recorded it).
    const runInvocation = async (): Promise<void> => {
      const session = deps.sessions.getOrCreate(key, mapping.identity);
      log.info(
        `invoking claude in ${mapping.workspace} ` +
          `(session ${key}, resume=${session.claudeSessionId ?? "new"})`,
      );
      try {
        const result = await invoke({
          bin: deps.claudeBin,
          workspace: mapping.workspace,
          prompt: decision.prompt!,
          resumeSessionId: session.claudeSessionId,
          runner: deps.runner,
        });
        if (result.sessionId && !session.claudeSessionId) {
          deps.sessions.setClaudeSessionId(key, result.sessionId);
        }
        deps.sessions.incrementProcessed(key);
        await deps.post(
          msg.channel,
          withIdentity(mapping.identity, result.text),
          decision.replyThreadTs,
        );
        log.info(`replied to session ${key}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`claude invocation failed: ${message}`);
        await deps.post(
          msg.channel,
          withIdentity(mapping.identity, `:warning: Claude invocation failed: ${message}`),
          decision.replyThreadTs,
        );
      }
    };

    await (deps.serializer ? deps.serializer.run(key, runInvocation) : runInvocation());
  }
}
