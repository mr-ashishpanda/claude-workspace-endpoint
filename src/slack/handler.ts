import { Logger } from "../logger.js";
import { Mapping } from "../config/types.js";
import { MappingStore } from "../config/mappings.js";
import { SessionStore } from "../session/store.js";
import { KeyedSerializer } from "../session/serializer.js";
import { ClaudeResult, ProcessRunner, invokeClaude } from "../claude/invoke.js";
import { ActivityInput } from "../audit/recorder.js";
import { MediaStore } from "../session/media.js";
import { InboundMessage, route } from "./router.js";
import { formatStatus, withIdentity, withSessionHeader } from "./status.js";
import { SlackFile, partitionFiles, formatUnsupportedNotice, buildImagePrompt } from "./files.js";
import { withSlackPrefix } from "./slack-prefix.js";

/** Posts a reply to Slack. `threadTs` undefined ⇒ post to the channel root. */
export type Poster = (channel: string, text: string, threadTs: string | undefined) => Promise<void>;

/** Downloads a Slack file's bytes (real impl authenticates with the bot token). */
export type FileDownloader = (file: SlackFile) => Promise<Buffer>;

/** Adds/removes an emoji reaction on the triggering message, to show live progress. */
export interface ReactionClient {
  add(channel: string, ts: string, emoji: string): Promise<void>;
  remove(channel: string, ts: string, emoji: string): Promise<void>;
}

/** Reaction shown while a message is accepted and being worked on. */
const PROCESSING_EMOJI = "eyes";
/** Reaction shown once Claude has replied successfully. */
const COMPLETE_EMOJI = "white_check_mark";

/** Best-effort reaction add/remove: never lets a reaction failure break the reply flow. */
async function tryReact(
  react: ReactionClient | undefined,
  log: Logger,
  action: "add" | "remove",
  channel: string,
  ts: string,
  emoji: string,
): Promise<void> {
  if (!react) return;
  try {
    await react[action](channel, ts, emoji);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`failed to ${action} :${emoji}: reaction: ${message}`);
  }
}

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
  /**
   * Resolves a Slack user id to a display name for the `[Slack: <name>]` tag.
   * Absent ⇒ the raw Slack user id is used as-is.
   */
  resolveUser?: (userId: string) => Promise<string>;
  /** Caches downloaded images so Claude can read them by path. */
  media?: MediaStore;
  /** Optional runner override (tests inject a fake to avoid spawning claude). */
  runner?: ProcessRunner;
  /** Adds/removes progress reactions on the triggering message. Absent ⇒ skipped. */
  react?: ReactionClient;
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
  /** Records an audit activity per invocation (fire-and-forget). Absent ⇒ no auditing. */
  audit?: { record(activity: ActivityInput): void };
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

    // action === "invoke". Mark the triggering message as accepted right away;
    // the reaction is swapped for a completion mark (or just removed on
    // failure/no-op) in the `finally` below, covering every exit path.
    await tryReact(deps.react, log, "add", msg.channel, msg.ts, PROCESSING_EMOJI);

    // Serialize per session key so concurrent delivery to the same scope
    // reuses one Claude session (reads the resume id only after any in-flight
    // invocation for this key has recorded it).
    const runInvocation = async (): Promise<void> => {
      let succeeded = false;
      try {
        await runOneInvocation();
      } finally {
        await tryReact(deps.react, log, "remove", msg.channel, msg.ts, PROCESSING_EMOJI);
        if (succeeded) {
          await tryReact(deps.react, log, "add", msg.channel, msg.ts, COMPLETE_EMOJI);
        }
      }

      async function runOneInvocation(): Promise<void> {
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

        const rawPrompt = decision.prompt ?? "";
        // Nothing Claude can act on (e.g. only unsupported files): the notice was
        // already posted, so don't create a session or invoke. Checked on the raw
        // prompt, before any Slack-prefix tag, so a bare tag never counts as
        // "actionable" on its own.
        if (!rawPrompt.trim() && imagePaths.length === 0) {
          log.info(`no actionable content for session ${key}; not invoking`);
          return;
        }

        const auditPrompt = rawPrompt;
        const startedAt = Date.now();
        const auditBase = {
          slackTs: msg.ts,
          user: msg.user,
          channel: msg.channel,
          threadTs: decision.replyThreadTs,
          identity: mapping.identity,
          workspace: mapping.workspace,
          claudeConfigDir: mapping.claudeConfigDir,
          prompt: auditPrompt,
          auditOverride: mapping.audit,
        };
        const recordError = (message: string): void =>
          deps.audit?.record({
            ...auditBase,
            durationMs: Date.now() - startedAt,
            outcome: "error",
            error: message,
            sessionId: null,
            tokens: { input: 0, output: 0 },
          });

        const taggedPrompt = mapping.slackPrefix
          ? await withSlackPrefix(rawPrompt, msg.user, deps.resolveUser)
          : rawPrompt;
        const prompt = buildImagePrompt(taggedPrompt, imagePaths);

        const session = deps.sessions.getOrCreate(key, mapping.identity);
        const effectiveConfigDir = mapping.claudeConfigDir;
        // Claude stores sessions per config dir, so a stored id is only resumable
        // under the same CLAUDE_CONFIG_DIR it was created with. On a mismatch,
        // skip the (doomed) resume and start fresh instead of failing.
        const configMatches = (session.claudeConfigDir ?? undefined) === effectiveConfigDir;
        const priorId = configMatches ? session.claudeSessionId : null;
        if (session.claudeSessionId && !configMatches) {
          log.warn(
            `config dir for session ${key} changed ` +
              `(was ${session.claudeConfigDir ?? "default"}, now ${effectiveConfigDir ?? "default"}); ` +
              `starting a fresh session`,
          );
        }
        log.info(
          `invoking claude in ${mapping.workspace} (session ${key}, resume=${priorId ?? "new"})`,
        );

        const attempt = (resumeSessionId: string | null): Promise<ClaudeResult> =>
          invoke({
            bin: deps.claudeBin,
            workspace: mapping.workspace,
            prompt,
            resumeSessionId,
            model: mapping.model,
            skipPermissions: mapping.skipPermissions,
            claudeConfigDir: mapping.claudeConfigDir,
            runner: deps.runner,
          });

        let result: ClaudeResult;
        try {
          result = await attempt(priorId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A stored Claude session id can become unresumable (pruned, or a
          // different CLAUDE_CONFIG_DIR). Rather than break this scope forever,
          // retry once with a fresh session. With no prior id, don't retry.
          if (!priorId) {
            log.error(`claude invocation failed: ${message}`);
            await deps.post(
              msg.channel,
              withIdentity(mapping.identity, `:warning: Claude invocation failed: ${message}`),
              decision.replyThreadTs,
            );
            recordError(message);
            return;
          }
          log.warn(`resume of ${priorId} failed (${message}); starting a fresh session`);
          try {
            result = await attempt(null);
          } catch (err2) {
            const message2 = err2 instanceof Error ? err2.message : String(err2);
            log.error(`claude invocation failed: ${message2}`);
            await deps.post(
              msg.channel,
              withIdentity(mapping.identity, `:warning: Claude invocation failed: ${message2}`),
              decision.replyThreadTs,
            );
            recordError(message2);
            return;
          }
        }

        // Store a newly-established id (first reply, or a fresh session after a
        // failed/skipped resume) together with the config dir it was created
        // under, so future resumes are attempted only when they can succeed.
        const establishedNew = result.sessionId != null && result.sessionId !== priorId;
        if (establishedNew) {
          deps.sessions.setClaudeSessionId(key, result.sessionId!, effectiveConfigDir);
        }
        deps.sessions.incrementProcessed(key);
        // Head the reply with `identity | session-id` so the resumable session is
        // visible on every answer. Fall back to the plain identity tag if Claude
        // returned no session id (rare).
        const body = result.sessionId
          ? withSessionHeader(mapping.identity, result.sessionId, result.text)
          : withIdentity(mapping.identity, result.text);
        await deps.post(msg.channel, body, decision.replyThreadTs);
        log.info(`replied to session ${key}`);
        succeeded = true;
        deps.audit?.record({
          ...auditBase,
          durationMs: Date.now() - startedAt,
          outcome: "success",
          sessionId: result.sessionId,
          tokens: result.usage,
          response: result.text,
        });
      }
    };

    await (deps.serializer ? deps.serializer.run(key, runInvocation) : runInvocation());
  }
}
