import { describe, it, expect } from "vitest";
import { KeyedSerializer } from "./serializer.js";

/** A manually-resolvable promise for deterministic ordering control. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("KeyedSerializer", () => {
  it("runs same-key tasks strictly in submission order", async () => {
    const s = new KeyedSerializer();
    const order: number[] = [];
    const g1 = deferred<void>();

    const p1 = s.run("k", async () => {
      await g1.promise; // block task 1 until we release it
      order.push(1);
    });
    const p2 = s.run("k", async () => {
      order.push(2);
    });

    // Task 2 must not have run while task 1 is still blocked.
    await Promise.resolve();
    expect(order).toEqual([]);

    g1.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("runs different keys concurrently", async () => {
    const s = new KeyedSerializer();
    const a = deferred<void>();
    let bRan = false;

    const pa = s.run("a", async () => {
      await a.promise;
    });
    const pb = s.run("b", async () => {
      bRan = true;
    });

    await pb; // key "b" should finish without waiting on key "a"
    expect(bRan).toBe(true);
    a.resolve();
    await pa;
  });

  it("continues the chain after a task throws", async () => {
    const s = new KeyedSerializer();
    const p1 = s.run("k", async () => {
      throw new Error("boom");
    });
    await expect(p1).rejects.toThrow("boom");
    const p2 = s.run("k", async () => "ok");
    await expect(p2).resolves.toBe("ok");
  });
});
