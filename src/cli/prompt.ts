import { createInterface, Interface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Readable } from "node:stream";

/** Where prompt labels are written (stdout by default; injectable for tests). */
export interface PromptWriter {
  write(text: string): void;
}

/**
 * Interactive CLI prompter built on event-based readline with a line queue.
 *
 * `readline/promises`' `question()` only resolves its first call when stdin is
 * piped (non-TTY), so it can't be driven non-interactively in tests or scripts.
 * Queueing 'line' events ourselves works for both a real terminal and piped
 * input, and degrades cleanly to defaults on EOF. The input stream and writer
 * are injectable so the behavior is unit-testable without a real TTY.
 */
export class Prompter {
  private readonly rl: Interface;
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string | null) => void)[] = [];
  private readonly out: PromptWriter;
  private closed = false;

  constructor(input: Readable = stdin, out: PromptWriter = stdout) {
    this.out = out;
    this.rl = createInterface({ input });
    this.rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.lines.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      while (this.waiters.length) this.waiters.shift()!(null);
    });
  }

  /** Next input line, or null at end of input. */
  private nextLine(): Promise<string | null> {
    const buffered = this.lines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Ask a free-text question with an optional default (used on empty/EOF). */
  async ask(question: string, fallback?: string): Promise<string> {
    const suffix = fallback ? ` [${fallback}]` : "";
    this.out.write(`${question}${suffix}: `);
    const line = await this.nextLine();
    const answer = (line ?? "").trim();
    return answer || fallback || "";
  }

  /** Ask the user to pick one of a fixed set of choices. */
  async choose<T extends string>(
    question: string,
    choices: readonly T[],
    fallback?: T,
  ): Promise<T> {
    const list = choices.join(" / ");
    for (;;) {
      const answer = (await this.ask(`${question} (${list})`, fallback)) as T;
      if (choices.includes(answer)) return answer;
      if (this.closed && this.lines.length === 0) {
        throw new Error(`Expected one of: ${list}; got "${answer}".`);
      }
      this.out.write(`  Please enter one of: ${list}\n`);
    }
  }

  /** Yes/no confirmation, defaulting to no. */
  async confirm(question: string): Promise<boolean> {
    const answer = (await this.ask(`${question} (y/N)`)).toLowerCase();
    return answer === "y" || answer === "yes";
  }

  close(): void {
    this.rl.close();
  }
}
