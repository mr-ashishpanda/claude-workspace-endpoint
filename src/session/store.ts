import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
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
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("sessions file is not a JSON array");
      return new SessionStore(file, parsed as SessionRecord[]);
    } catch {
      // Corrupt or partially-written sessions file (e.g. a crash mid-write).
      // Quarantine it and start fresh rather than refusing to boot — session
      // state is reconstructable, and a local-first bridge must still start.
      // The bad file is preserved as `<file>.corrupt` for inspection.
      try {
        renameSync(file, file + ".corrupt");
      } catch {
        // If it can't be moved, carry on with empty in-memory state anyway.
      }
      return new SessionStore(file, []);
    }
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

  /**
   * Record the Claude session id (and the config dir it was created under, so a
   * later resume can be skipped when the config dir no longer matches).
   */
  setClaudeSessionId(key: string, claudeSessionId: string, claudeConfigDir?: string): void {
    const record = this.sessions.get(key);
    if (!record) return;
    record.claudeSessionId = claudeSessionId;
    if (claudeConfigDir) record.claudeConfigDir = claudeConfigDir;
    else delete record.claudeConfigDir;
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
