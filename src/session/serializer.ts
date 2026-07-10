/**
 * Serializes async tasks per key: tasks sharing a key run strictly one at a
 * time, in submission order, while different keys run concurrently.
 *
 * The bridge uses this keyed on the session key so concurrently-delivered Slack
 * messages for the same channel/thread can't race — without it, two messages
 * arriving before the first Claude call returns would both start a *new* Claude
 * session (resume id not yet recorded), breaking "one session per scope".
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Chain after the previous task regardless of whether it resolved or threw.
    const next = prev.then(
      () => task(),
      () => task(),
    );
    // Track a never-rejecting tail so the chain isn't broken by a failure, and
    // drop the entry once it's the last one to avoid unbounded growth.
    const settled = next.then(
      () => {},
      () => {},
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return next;
  }
}
