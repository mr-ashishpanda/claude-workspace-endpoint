import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaStore } from "./media.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scb-media-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("MediaStore", () => {
  it("writes a buffer under <home>/media/<key>/ and returns the absolute path", () => {
    const store = new MediaStore(home);
    const data = Buffer.from("PNGDATA");
    const path = store.save("C1-171.5", "diagram.png", data);

    expect(path).toBe(join(home, "media", "C1-171.5", "diagram.png"));
    expect(readFileSync(path)).toEqual(data);
  });

  it("sanitizes the key and filename so they can't escape the media dir", () => {
    const store = new MediaStore(home);
    const path = store.save("../../etc", "../../passwd", Buffer.from("x"));
    expect(path.startsWith(join(home, "media"))).toBe(true);
    expect(path).not.toContain("..");
  });

  it("keeps two files with the same name under one key distinct", () => {
    const store = new MediaStore(home);
    const a = store.save("k", "img.png", Buffer.from("a"));
    const b = store.save("k", "img.png", Buffer.from("b"));
    expect(a).not.toBe(b);
    expect(readFileSync(a).toString()).toBe("a");
    expect(readFileSync(b).toString()).toBe("b");
  });
});
