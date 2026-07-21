import { expect, it } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSessionRef } from "./session-ref.js";

it("returns null when session id is null", () => {
  expect(deriveSessionRef({ sessionId: null, workspace: "/w" })).toBeNull();
});

it("returns the transcript path when it exists under the config dir", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  const proj = join(cfg, "projects", "-Users-x-repo");
  mkdirSync(proj, { recursive: true });
  const file = join(proj, "sess-1.jsonl");
  writeFileSync(file, "{}");
  expect(
    deriveSessionRef({ sessionId: "sess-1", workspace: "/Users/x/repo", claudeConfigDir: cfg }),
  ).toBe(file);
});

it("returns null when the transcript file is absent", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  expect(
    deriveSessionRef({ sessionId: "nope", workspace: "/Users/x/repo", claudeConfigDir: cfg }),
  ).toBeNull();
});
