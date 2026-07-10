import { Logger } from "../logger.js";
import { Mapping } from "../config/types.js";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { KeyedSerializer } from "../session/serializer.js";
import { ClaudeResult, ProcessRunner, invokeClaude } from "../claude/invoke.js";
import { MediaStore } from "../session/media.js";
import { InboundMessage, route } from "./router.js";
import { formatStatus, withIdentity, sessionStartedFooter } from "./status.js";
import { SlackFile, partitionFiles, formatUnsupportedNotice, buildImagePrompt } from "./files.js";

/** Posts a reply to Slack. `threadTs` undefined ⇒ post to the channel root. */
export type Poster = (channel: string, text: string, threadTs: string | undefined) => Promise<void>;

/** Downloads a Slack file's bytes (real impl authenticates with the bot token). */
export type FileDownloader = (file: SlackFile) => Promise<Buffer>;

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
  /** Downloads Slack image attachments. Absent ⇒ attachments are skipped. */
  download?: FileDownloader;
  /** Caches downloaded images so Claude can read them by path. */
  media?: MediaStore;
  /** Optional runner override (tests inject a fake to avoid spawning claude). */
  runner?: ProcessRunner;
  /** Override the Claude invocation entirely (tests). */
  invoke?: (args: {
    bin: string;
    workspace: string;
    prompt: string;
    resumeSessionId: string | null;
    model?: Mapping["model"];
    skipPermissions?: boolean;
    claudeConfigDir?: string;
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
    log.debug(
      `inbound text=${JSON.stringify(msg.text)} mentionsBot=${msg.mentionsBot} ` +
        `fromBot=${msg.fromBot} → ${decision.action}`,
    );
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
      // Handle attachments first: warn about unsupported files, download the
      // supported images into the app data dir, and fold their paths into the
      // prompt so Claude can read them.
      const { images, unsupported } = partitionFiles(msg.files ?? []);
      if (unsupported.length > 0) {
        log.info(`skipping ${unsupported.length} unsupported file(s) for session ${key}`);
        await deps.post(
          msg.channel,
          withIdentity(mapping.identity, formatUnsupportedNotice(unsupported)),
          decision.replyThreadTs,
        );
      }

      const imagePaths: string[] = [];
      if (images.length > 0 && deps.download && deps.media) {
        for (const img of images) {
          try {
            const bytes = await deps.download(img);
            imagePaths.push(deps.media.save(key, img.name, bytes));
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            log.error(`failed to download image ${img.name}: ${m}`);
          }
        }
      }

      const prompt = buildImagePrompt(decision.prompt ?? "", imagePaths);
      // Nothing Claude can act on (e.g. only unsupported files): the notice was
      // already posted, so don't create a session or invoke.
      if (!prompt.trim() && imagePaths.length === 0) {
        log.info(`no actionable content for session ${key}; not invoking`);
        return;
      }

      const session = deps.sessions.getOrCreate(key, mapping.identity);
      log.info(
        `invoking claude in ${mapping.workspace} ` +
          `(session ${key}, resume=${session.claudeSessionId ?? "new"})`,
      );
      try {
        const result = await invoke({
          bin: deps.claudeBin,
          workspace: mapping.workspace,
          prompt,
          resumeSessionId: session.claudeSessionId,
          model: mapping.model,
          skipPermissions: mapping.skipPermissions,
          claudeConfigDir: mapping.claudeConfigDir,
          runner: deps.runner,
        });
        // First reply of a session: capture the id and advertise it (once) so
        // the hidden headless session can be resumed by a human.
        const isFirstReply = result.sessionId != null && !session.claudeSessionId;
        if (isFirstReply) {
          deps.sessions.setClaudeSessionId(key, result.sessionId!);
        }
        deps.sessions.incrementProcessed(key);
        const body = isFirstReply
          ? `${result.text}\n\n${sessionStartedFooter(mapping.identity, result.sessionId!)}`
          : result.text;
        await deps.post(msg.channel, withIdentity(mapping.identity, body), decision.replyThreadTs);
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
