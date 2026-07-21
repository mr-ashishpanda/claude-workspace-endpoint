import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditConfigStore } from "./audit-config.js";
import { DEFAULT_AUDIT_CONFIG } from "./types.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "audit-cfg-"));
}

it("returns defaults when no file exists", () => {
  expect(AuditConfigStore.load(tmp()).get()).toEqual(DEFAULT_AUDIT_CONFIG);
});

it("persists and reloads a patch, merging retention", () => {
  const home = tmp();
  AuditConfigStore.load(home).set({ enabled: true, summary: true });
  const cfg = AuditConfigStore.load(home).get();
  expect(cfg.enabled).toBe(true);
  expect(cfg.summary).toBe(true);
  expect(cfg.retention).toEqual(DEFAULT_AUDIT_CONFIG.retention);
});
