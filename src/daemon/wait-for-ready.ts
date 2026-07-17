/** The slice of a spawned child process this needs — real `ChildProcess` satisfies it. */
export interface ChildLike {
  once(event: "message", listener: (msg: unknown) => void): void;
  once(event: "error", listener: (err: Error) => void): void;
  once(event: "exit", listener: (code: number | null) => void): void;
}

export type ReadyResult = { ok: true; pid: number } | { ok: false; message: string };

/** Message shape the daemon child sends back over IPC (see cli/index.ts's child mode). */
interface DaemonMessage {
  type?: string;
  pid?: number;
  message?: string;
}

/**
 * Wait for a spawned bridge child to report it's connected to Slack (or fail).
 * Resolves — never rejects — so callers always get an actionable result rather
 * than an unhandled rejection from a background launcher.
 */
export function waitForReady(child: ChildLike, timeoutMs = 30_000): Promise<ReadyResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ReadyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, message: "timed out waiting for the bridge to start" }),
      timeoutMs,
    );

    child.once("message", (raw) => {
      const msg = raw as DaemonMessage;
      if (msg?.type === "ready" && typeof msg.pid === "number") {
        finish({ ok: true, pid: msg.pid });
      } else {
        finish({ ok: false, message: msg?.message ?? "bridge reported a failure starting up" });
      }
    });
    child.once("error", (err) => finish({ ok: false, message: err.message }));
    child.once("exit", (code) =>
      finish({ ok: false, message: `bridge process exited early (code ${code ?? "unknown"})` }),
    );
  });
}
