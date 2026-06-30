import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { SessionRecord } from "../config/types.js";
import { resolveHome, sessionsPath } from "../config/paths.js";

/**
 * Persistent store of Claude sessions, keyed by scope key. Written to disk on
 * every mutation so sessions survive bridge restarts (PRD: session persistence).
 */
export class SessionStore {
  private sessions: Map<string, SessionRecord>;

  private constructor(
    private readonly file: string,
    records: SessionRecord[],
  ) {
    this.sessions = new Map(records.map((r) => [r.key, r]));
  }

  static load(home: string = resolveHome()): SessionStore {
    const file = sessionsPath(home);
    if (!existsSync(file)) return new SessionStore(file, []);
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return new SessionStore(file, []);
    const parsed = JSON.parse(raw) as SessionRecord[];
    return new SessionStore(file, Array.isArray(parsed) ? parsed : []);
  }

  get(key: string): SessionRecord | undefined {
    return this.sessions.get(key);
  }

  /**
   * Return the existing session for `key`, or create and persist a fresh one.
   * `now` is injectable for deterministic tests.
   */
  getOrCreate(key: string, identity: string, now: () => Date = () => new Date()): SessionRecord {
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const record: SessionRecord = {
      key,
      identity,
      claudeSessionId: null,
      messagesProcessed: 0,
      createdAt: now().toISOString(),
    };
    this.sessions.set(key, record);
    this.persist();
    return record;
  }

  /** Record the Claude session id returned by the first invocation. */
  setClaudeSessionId(key: string, claudeSessionId: string): void {
    const record = this.sessions.get(key);
    if (!record) return;
    record.claudeSessionId = claudeSessionId;
    this.persist();
  }

  /** Increment the processed-message counter for a session. */
  incrementProcessed(key: string): void {
    const record = this.sessions.get(key);
    if (!record) return;
    record.messagesProcessed += 1;
    this.persist();
  }

  all(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.all(), null, 2) + "\n");
  }
}
